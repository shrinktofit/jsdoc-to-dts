
import * as dtsdom from 'dts-dom';
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import mkdirp = require('mkdirp');

export class Emitter {
    private _typeChecker: ts.TypeChecker;

    private _modules: Map<ts.SourceFile, ModuleInfo> = new Map();

    constructor(inputs: string[]) {
        const rootNames: string[] = [];
        const relativeNames: string[] = [];
        inputs.forEach((input) => {
            const stat = fs.statSync(input);
            if (stat.isFile()) {
                rootNames.push(path.normalize(input));
                relativeNames.push(path.basename(input));
            } else {
                iterateOverDirectory(input, (filepath) => {
                    if (filepath.endsWith('.js')) {
                        rootNames.push(path.normalize(filepath));
                        relativeNames.push(path.relative(input, rootNames[rootNames.length - 1]);
                    }
                });
            }
        });

        const compilerOptions: ts.CompilerOptions = {
            allowJs: true,
            checkJs: true,
        };

        const program = ts.createProgram(rootNames, compilerOptions);
        this._typeChecker = program.getTypeChecker();

        const sourceFiles = program.getSourceFiles();
        sourceFiles.forEach((sourceFile) => {
            const n = path.normalize(sourceFile.fileName);
            const rootNameIndex = rootNames.findIndex((rootName) => rootName === n);
            if (rootNameIndex >= 0) {
                this._processSourceFile(sourceFile, relativeNames[rootNameIndex]);
            }
        });
    }

    emit(outputDir: string) {
        this._modules.forEach((moduleInfo) => {
            let output = '';
            moduleInfo.topLevelDeclarations.forEach((topLevelDeclaration) => {
                output += dtsdom.emit(topLevelDeclaration);
            });

            const outputPath = path.join(outputDir, moduleInfo.path);
            const outputFileDir = path.dirname(outputPath);
            if (!fs.existsSync(outputFileDir)) {
                mkdirp.sync(outputFileDir);
            }
            fs.writeFileSync(outputPath, output);
        });
    }

    private _processSourceFile(sourceFile: ts.SourceFile, relativePath: string) {
        console.log(`Processing ${sourceFile.fileName}`);

        const moduleInfo = new ModuleInfo();
        moduleInfo.path = relativePath.replace('.js', '.d.ts');
        this._modules.set(sourceFile, moduleInfo);

        this._processNode(sourceFile, moduleInfo);
    }

    private _processNode(astNode: ts.Node, moduleInfo: ModuleInfo) {
        if (ts.isClassDeclaration(astNode)) {
            this._makeClassDeclaration(astNode, moduleInfo);
        } else {
            astNode.getChildren().forEach((childNode) => {
                this._processNode(childNode, moduleInfo);
            });
        }
    }

    private _makeClassDeclaration(astNode: ts.ClassDeclaration, moduleInfo: ModuleInfo) {
        if (!astNode.name) {
            return;
        }

        const dtsClassDecl = dtsdom.create.class(astNode.name.text);
        moduleInfo.topLevelDeclarations.push(dtsClassDecl);

        const processedAccessors = new Set<string>();
        for (const member of astNode.members) {
            if (ts.isMethodDeclaration(member)) {
                let returnType: dtsdom.Type = dtsdom.type.any;
                let returnTags = ts.getAllJSDocTagsOfKind(member, ts.SyntaxKind.JSDocReturnTag);
                if (returnTags.length !== 0) {
                    const returnTag = returnTags[0] as ts.JSDocReturnTag;
                    if (returnTag.typeExpression) {
                        returnType = this._typeNodeToDTSdomType(returnTag.typeExpression.type);
                    }
                }
                const method = dtsdom.create.method(member.name.getText(), this._makeDTSParams(member), returnType);
                dtsClassDecl.members.push(method);
            } else if (ts.isPropertyDeclaration(member)) {
                const property = dtsdom.create.property(member.name.getText(), this._tryResolveTypeTag(member));
                dtsClassDecl.members.push(property);
            } else if (ts.isAccessor(member)) {
                const name = member.name.getText();
                if (!processedAccessors.has(name)) {
                    processedAccessors.add(name);
                    let hasSetter = false;
                    if (ts.isSetAccessor(member)) {
                        hasSetter = true;
                    } else {
                        astNode.members.forEach((member) => {
                            if (ts.isSetAccessor(member) && member.name.getText() === name) {
                                hasSetter = true;
                            }
                        });
                    }
                    let flags: dtsdom.DeclarationFlags = 0;
                    if (!hasSetter) {
                        flags |= dtsdom.DeclarationFlags.ReadOnly;
                    }
                    const property = dtsdom.create.property(member.name.getText(), this._tryResolveTypeTag(member), flags);
                    dtsClassDecl.members.push(property);
                }
            }
        }

        if (astNode.heritageClauses) {
            astNode.heritageClauses.forEach((heritage) => {
                this._resolveDTSHeritage(heritage);
            });
        }
    }

    private _resolveDTSHeritage(heritage: ts.HeritageClause) {
        heritage.types.forEach((heritageType) => {
            const type = this._typeChecker.getTypeAtLocation(heritageType);
            const typeSymbol = type.getSymbol();
            if (typeSymbol) {
                const decl = typeSymbol.valueDeclaration;
                if (this._isNodeExported(decl)) {
                    const p1 = path.dirname(heritage.getSourceFile().fileName;
                    const p2 = decl.getSourceFile().fileName;
                    const p = path.relative(p1, p2);
                    console.log(`${typeSymbol.name} is exported at ${p} relative to ${p1}`);
                }
            }
        });
    }

    /** True if this is visible outside this file, false otherwise */
    private _isNodeExported(node: ts.Declaration): boolean {
        return (
            (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export) !== 0 ||
            (!!node.parent && node.parent.kind === ts.SyntaxKind.SourceFile)
        );
    }

    private _makeDTSParams(astNode: ts.MethodDeclaration | ts.FunctionDeclaration) {
        const paramTags = ts.getAllJSDocTagsOfKind(astNode, ts.SyntaxKind.JSDocParameterTag) as ts.JSDocParameterTag[];
        return astNode.parameters.map((param) => {
            const paramName = param.name.getText();
            const paramTag = paramTags.find((paramTag) => paramTag.name.getText() === paramName) as ts.JSDocParameterTag;

            let type: dtsdom.Type = dtsdom.type.any;
            if (paramTag !== undefined && paramTag.typeExpression) {
                type = this._typeNodeToDTSdomType(paramTag.typeExpression.type);
            }

            return dtsdom.create.parameter(paramName, type);
        });
    }

    private _tryResolveTypeTag(astNode: ts.AccessorDeclaration | ts.PropertyDeclaration) {
        const tags = ts.getAllJSDocTagsOfKind(astNode, ts.SyntaxKind.JSDocTypeTag);
        if (tags.length !== 0) {
            const typeTag = tags[0] as ts.JSDocTypeTag;
            if (typeTag.typeExpression) {
                return this._typeNodeToDTSdomType(typeTag.typeExpression.type);
            }
        }
        return dtsdom.type.any;
    }

    private _typeNodeToDTSdomType(typeNode: ts.TypeNode): dtsdom.Type {
        const type = this._typeChecker.getTypeAtLocation(typeNode);
        if (!type.getSymbol() && (type as any).intrinsicName === 'error') {
            console.log(`type ${typeNode.getText()} has no symbol`);
        }
        return dtsdom.create.namedTypeReference(typeNode.getText());
    }
}

class ModuleInfo {
    path: string = '';

    topLevelDeclarations: Array<dtsdom.TopLevelDeclaration> = [];
}

function iterateOverDirectory(rootPath: string, fx: (path: string) => void) {
    const items = fs.readdirSync(rootPath);
    items.forEach((subPath: string) => {
        const itemAbsPath = path.resolve(rootPath, subPath);
        const itemInfo = fs.statSync(itemAbsPath);
        if (itemInfo.isFile()) {
            fx(itemAbsPath);
        } else if (itemInfo.isDirectory()) {
            iterateOverDirectory(itemAbsPath, fx);
        }
    });
}