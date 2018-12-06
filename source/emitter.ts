
import * as dtsdom from 'dts-dom';
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import mkdirp = require('mkdirp');

export interface EmitterOtions
{
    inputs: string[];
    outputDir: string;
    excludes: string[];
}

class SymbolInfo {
    constructor(private _dtsDeclaration?: dtsdom.DeclarationBase) {

    }

    get resolved() {
        return this.dtsDeclaration !== undefined;
    }

    get dtsDeclaration() {
        return this._dtsDeclaration!;
    }
}

export class Emitter {
    private _typeChecker: ts.TypeChecker;

    private _symbols: Map<ts.Symbol, SymbolInfo> = new Map();

    constructor(private _options: EmitterOtions) {
        const rootNames: string[] = [];
        const relativeNames: string[] = [];
        const addFile = (filePath: string, relativePath: string) => {
            if (this._isExcluded(filePath)) {
                return;
            }
            rootNames.push(filePath);
            relativeNames.push(relativePath)
        };
        _options.inputs.forEach((input) => {
            const stat = fs.statSync(input);
            if (stat.isFile()) {
                const normalized = path.normalize(input);
                addFile(normalized, path.basename(normalized));
            } else {
                iterateOverDirectory(input, (filePath) => {
                    const normalized = path.normalize(filePath);
                    if (normalized.endsWith('.js')) {
                        addFile(normalized, path.relative(input, normalized));
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
        // sourceFiles.forEach((sourceFile) => {
        //     const n = path.normalize(sourceFile.fileName);
        //     const rootNameIndex = rootNames.findIndex((rootName) => rootName === n);
        //     if (rootNameIndex >= 0) {
        //         // DO IT: Should we use program.isSourceFileDefaultLibrary(sourceFile) && program.isSourceFileFromExternalLibrary(sourceFile)?
        //         this._processSourceFile(sourceFile, relativeNames[rootNameIndex]);
        //     }
        // });

        const mainSourceFile = sourceFiles.find(sourceFile => {
            return path.normalize(sourceFile.fileName) === path.normalize(_options.inputs[0]);
        });
        if (!mainSourceFile) {
            throw new Error(`Cannot find main source file ${_options.inputs[0]}.`);
        }

        //const moduleSymbols = this._typeChecker.getExportsOfModule(this._typeChecker.getSymbolAtLocation(mainSourceFile)!);
        const moduleSymbols = this._typeChecker.getSymbolsInScope(mainSourceFile, ts.SymbolFlags.Module);
        moduleSymbols.forEach(moduleSymbol => {
            if (moduleSymbol.name === 'cc') {
                this._getSymbolInfo(moduleSymbol);
            }
        });
    }

    emit() {
        let output = '';

        this._symbols.forEach((symbolInfo) => {
            if (!symbolInfo.resolved) {
                return;
            }
            if (!isDtsTopLevelDeclaration(symbolInfo.dtsDeclaration)) {
                return;
            }
            output += dtsdom.emit(symbolInfo.dtsDeclaration);
        });

        const outputPath = path.join(this._options.outputDir, 'cocos-creator-3d.d.ts');
        const outputFileDir = path.dirname(outputPath);
        if (!fs.existsSync(outputFileDir)) {
            mkdirp.sync(outputFileDir);
        }
        fs.writeFileSync(outputPath, output);
    }

    private _isExcluded(path: string) {
        return this._options.excludes.findIndex((exclude) => {
            return new RegExp(exclude).test(path);
        }) >= 0;
    }

    private _getSymbolInfo(symbol: ts.Symbol) {
        let symbolInfo = this._symbols.get(symbol);
        if (symbolInfo === undefined) {
            symbolInfo = this._resolveSymbol(symbol, (result) => {
                symbolInfo = result;
                this._symbols.set(symbol, result);
            });
            this._symbols.set(symbol, symbolInfo);
        }
        return symbolInfo;
    }

    private _resolveSymbol(symbol: ts.Symbol, add: (result: SymbolInfo) => void): SymbolInfo {
        const symbolFlags = symbol.getFlags();
        if (symbolFlags & ts.SymbolFlags.Class) {
            if (symbol.valueDeclaration) {
                const classDecl = this._makeClassDeclaration(symbol.valueDeclaration as ts.ClassDeclaration);
                if (classDecl) {
                    add(new SymbolInfo(classDecl));
                }
            }
        } else if (symbolFlags & ts.SymbolFlags.Function) {
            if (symbol.valueDeclaration) {
                const funcDecl = symbol.valueDeclaration as ts.FunctionDeclaration;
                if (funcDecl.name) {
                    const func = dtsdom.create.function(funcDecl.name.getText(), this._makeDTSParams(funcDecl), this._makeDTSReturnType(funcDecl));
                    add(new SymbolInfo(func));
                }
            }
        } else if (symbolFlags & ts.SymbolFlags.Namespace) {
            const dtsNamespace = dtsdom.create.namespace(ts.symbolName(symbol));
            add(new SymbolInfo(dtsNamespace));
            const x = this._typeChecker.getExportsOfModule(symbol);
            if (x) {
                x.forEach((y) => {
                    const sym = this._resolveSymbol(y, add);
                    if (sym.resolved) {
                        dtsNamespace.members.push(sym.dtsDeclaration);
                    }
                });
            }
        } else if (symbolFlags & ts.SymbolFlags.Module) {
            debugger;
        } else if (symbolFlags & (ts.SymbolFlags.Property | ts.SymbolFlags.Assignment)) {
            const declaration = symbol.valueDeclaration.parent as ts.BinaryExpression;
            console.log(declaration.getText());
            const rightSymbols: ts.Symbol[] = [];
            this._getSymbolOfExpr(declaration.right, ts.SymbolFlags.Class | ts.SymbolFlags.Function | ts.SymbolFlags.Interface | ts.SymbolFlags.Namespace, rightSymbols);
            for (const rightSymbol of rightSymbols) {
                const ss = this._typeChecker.getAliasedSymbol(rightSymbol);
                const rightSymbolInfo = this._getSymbolInfo(rightSymbol);
                add(rightSymbolInfo);
            }
        } else if (symbolFlags & ts.SymbolFlags.Alias) {
            debugger;
        } else {
            const s = symbolFlagToString(symbol.flags);
            console.error(s);
            debugger;
        }
        add(new SymbolInfo());
    }

    private _getSymbolOfExpr(expr: ts.Node, meaning: ts.SymbolFlags, result: ts.Symbol[]) {
        if (ts.isObjectLiteralExpression(expr)) {
            expr.properties.forEach(property => {
                if (property.name) {
                    this._getSymbolOfExpr(property.name, meaning, result);
                }
            });
        }
        else {
            const symbol = this._typeChecker.getSymbolAtLocation(expr);
            if (symbol) {
                result.push(symbol);
            }
        }
    }

    private _processSourceFile(sourceFile: ts.SourceFile, relativePath: string) {
        //console.log(`Processing ${sourceFile.fileName}`);
        //this._processNode(sourceFile);
    }

    private _processNode(astNode: ts.Node) {
        if (ts.isClassDeclaration(astNode)) {
            if (astNode.name) {
                const symbol = this._typeChecker.getSymbolAtLocation(astNode.name);
                if (symbol) {
                    this._getSymbolInfo(symbol);
                }
            }
        } else if (ts.isFunctionDeclaration(astNode)) {
            if (astNode.name) {
                const symbol = this._typeChecker.getSymbolAtLocation(astNode.name);
                if (symbol) {
                    this._getSymbolInfo(symbol);
                }
            }
        } else if (ts.isBinaryExpression(astNode) && astNode.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
           if (this._isNamespaceAssignment(astNode)) {
               //console.log(`Found namespace assigment ${astNode.getText()}`);
           }
        } else {
            astNode.getChildren().forEach((childNode) => {
                this._processNode(childNode);
            });
        }
    }

    private _isNamespaceAssignment(astNode: ts.BinaryExpression) {
        const rightSymbol = this._typeChecker.getSymbolAtLocation(astNode.right);
        if (!rightSymbol) {
            return false;
        }

        if (rightSymbol.valueDeclaration) {
            if (!ts.isClassDeclaration(rightSymbol.valueDeclaration) &&
                !ts.isFunctionDeclaration(rightSymbol.valueDeclaration)) {
                return false;
            }
        }
        else if (rightSymbol.declarations.length === 0) {
            return false;
        } else {
            const d = rightSymbol.declarations[0];
            if (!ts.isNamespaceImport(d)) {
                return false;
            } else {
                const s = this._typeChecker.getSymbolAtLocation(d.getSourceFile());
                const exportss = this._typeChecker.getExportsOfModule(s!);
                const exports = this._typeChecker.getExportSymbolOfSymbol(rightSymbol);
            }
        }

        const left = astNode.left;
        let p: ts.Expression = left;
        while (true) {
            if (ts.isIdentifier(p)) {
                return true;
            } else if (ts.isPropertyAccessExpression(p)) {
                p = p.expression;
            } else {
                return false;
            }
        }
    }

    private _makeClassDeclaration(astNode: ts.ClassDeclaration) {
        if (!astNode.name) {
            return null;
        }

        const dtsClassDecl = dtsdom.create.class(astNode.name.text);

        const processedAccessors = new Set<string>();
        for (const member of astNode.members) {
            if (ts.isMethodDeclaration(member)) {
                const method = dtsdom.create.method(member.name.getText(), this._makeDTSParams(member), this._makeDTSReturnType(member));
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
                this._resolveDTSHeritage(dtsClassDecl, heritage);
            });
        }

        return dtsClassDecl;
    }

    private _resolveDTSHeritage(dtsClassDecl: dtsdom.ClassDeclaration, heritage: ts.HeritageClause) {
        heritage.types.forEach((heritageType) => {
            const type = this._typeChecker.getTypeAtLocation(heritageType);
            const typeSymbol = type.getSymbol();
            if (!typeSymbol) {
                return;
            }
            const symbolInfo = this._getSymbolInfo(typeSymbol);
            if (!symbolInfo.resolved) {
                console.error(`${dtsClassDecl.name}'s hieritage ${heritage.getText()} cannot be resolved.`);
                return;
            }
            if (heritage.token === ts.SyntaxKind.ExtendsKeyword) {
                if (isDtsClassDeclaration(symbolInfo.dtsDeclaration)) {
                    dtsClassDecl.baseType = symbolInfo.dtsDeclaration;
                } else {
                    console.error(`${dtsClassDecl.name}'s hieritage ${heritage.getText()} shall be resolved to a class, but it's a ${symbolInfo.dtsDeclaration.kind}.`);
                }
            } else {
                if (isDtsInterfaceDeclaration(symbolInfo.dtsDeclaration)) {
                    dtsClassDecl.baseType = symbolInfo.dtsDeclaration;
                } else {
                    console.error(`${dtsClassDecl.name}'s hieritage ${heritage.getText()} shall be resolved to an interface, but it's a ${symbolInfo.dtsDeclaration.kind}.`);
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

    private _makeDTSReturnType(astNode: ts.MethodDeclaration | ts.FunctionDeclaration) {
        let returnType: dtsdom.Type = dtsdom.type.any;
        let returnTags = ts.getAllJSDocTagsOfKind(astNode, ts.SyntaxKind.JSDocReturnTag);
        if (returnTags.length !== 0) {
            const returnTag = returnTags[0] as ts.JSDocReturnTag;
            if (returnTag.typeExpression) {
                returnType = this._typeNodeToDTSdomType(returnTag.typeExpression.type);
            }
        }
        return returnType;
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
        switch (typeNode.kind) {
            // keyword types
            case ts.SyntaxKind.AnyKeyword:
            case ts.SyntaxKind.UnknownKeyword:
                return dtsdom.type.any;
            case ts.SyntaxKind.NumberKeyword:
                return dtsdom.type.number;
            case ts.SyntaxKind.ObjectKeyword:
                return dtsdom.type.object;
            case ts.SyntaxKind.BooleanKeyword:
                return dtsdom.type.boolean;
            case ts.SyntaxKind.StringKeyword:
                return dtsdom.type.string;
            case ts.SyntaxKind.ThisKeyword:
                return dtsdom.type.this;
            case ts.SyntaxKind.VoidKeyword:
                return dtsdom.type.void;
            case ts.SyntaxKind.UndefinedKeyword:
                return dtsdom.type.any;
            case ts.SyntaxKind.NullKeyword:
                return dtsdom.type.null;
        }

        if (ts.isTypeReferenceNode(typeNode)) {
            return dtsdom.create.namedTypeReference(typeNode.typeName.getText());
        } else if (ts.isArrayTypeNode(typeNode)) {
            return dtsdom.create.array(this._typeNodeToDTSdomType(typeNode.elementType));
        } else if (ts.isUnionTypeNode(typeNode)) {
            return dtsdom.create.union(typeNode.types.map((type) => this._typeNodeToDTSdomType(type)));
        } else if (ts.isLiteralTypeNode(typeNode)) {
            const literal = typeNode.literal;
            if (ts.isNumericLiteral(literal)) {
                return dtsdom.type.numberLiteral(Number(literal.text));
            } else if (ts.isStringLiteral(literal)) {
                return dtsdom.type.stringLiteral(literal.text);
            }
        } else if (ts.isTypeLiteralNode(typeNode)) {
            const dtsmembers: dtsdom.ObjectTypeMember[] = [];
            typeNode.members.forEach((member) => {
                if (ts.isPropertySignature(member)) {
                    dtsmembers.push(dtsdom.create.property(
                        member.name.getText(), member.type ?this._typeNodeToDTSdomType(member.type) : dtsdom.type.any
                        ));
                } else {
                    console.error(`Unrecognized member ${member.getText()} with kind ${syntaxKindToString(member.kind)} in type literal ${typeNode.getText()}.`);
                }
            })
            return dtsdom.create.objectType(dtsmembers);
        } else if (ts.isFunctionTypeNode(typeNode) || ts.isJSDocFunctionType(typeNode)) {
            const params = typeNode.parameters.map((param, index) => {
                const paramName = param.name ? param.name.getText() : `param_${index}`;
                if (!param.name) {
                    console.error(`Found unnamed parameter in function type ${typeNode.getText()}(param count: ${typeNode.parameters.length}), rename it to ${paramName}`);
                }
                return dtsdom.create.parameter(
                    paramName,
                    param.type ? this._typeNodeToDTSdomType(param.type) : dtsdom.type.any
                )
            });
            return dtsdom.create.functionType(
                params,
                typeNode.type ? this._typeNodeToDTSdomType(typeNode.type) : dtsdom.type.any
            );
        } else if (typeNode.kind === ts.SyntaxKind.JSDocAllType) {
            return dtsdom.type.any;
        } else if (ts.isJSDocTypeExpression(typeNode)) {
            return this._typeNodeToDTSdomType(typeNode.type);
        } else if (ts.isJSDocOptionalType(typeNode)) {
            return dtsdom.create.union([this._typeNodeToDTSdomType(typeNode.type), dtsdom.type.undefined]);
        } else if (ts.isJSDocNullableType(typeNode)) {
            return dtsdom.create.union([this._typeNodeToDTSdomType(typeNode.type), dtsdom.type.null]);
        }  else if (ts.isJSDocTypeLiteral(typeNode)) {
            const dtsmembers: dtsdom.ObjectTypeMember[] = [];
            if (typeNode.jsDocPropertyTags) {
                typeNode.jsDocPropertyTags.forEach((propertyTag) => {
                    dtsmembers.push(dtsdom.create.property(
                        propertyTag.name.getText(), propertyTag.typeExpression ?this._typeNodeToDTSdomType(propertyTag.typeExpression) : dtsdom.type.any,
                        propertyTag.isBracketed ? dtsdom.DeclarationFlags.Optional : 0
                        ));
                });
            }
            const result = dtsdom.create.objectType(dtsmembers);
            if (typeNode.isArrayType) {
                return dtsdom.create.array(result);
            } else {
                return result;
            }
        } else if (ts.isImportTypeNode(typeNode)) {
            const type = this._typeChecker.getTypeAtLocation(typeNode);
            const typeSymbol = type.getSymbol();
            if (!typeSymbol) {
                console.error(`import type node ${typeNode.getText()} has no symbol.`);
                return dtsdom.type.any;
            }
            const symbolInfo = this._getSymbolInfo(typeSymbol);
            if (!symbolInfo.resolved) {
                console.error(`import type node ${typeNode.getText()} has symbol unresolved.`);
                return dtsdom.type.any;
            }
            return dtsdom.create.namedTypeReference(((symbolInfo.dtsDeclaration as any).name));
        }
        
        console.error(`Unrecognized type ${typeNode.getText()} with kind ${syntaxKindToString(typeNode.kind)}`);
        return dtsdom.type.any;
    }
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

function isDtsClassDeclaration(declaration: dtsdom.DeclarationBase): declaration is dtsdom.ClassDeclaration {
    return (declaration as any).kind === 'class';
}

function isDtsInterfaceDeclaration(declaration: dtsdom.DeclarationBase): declaration is dtsdom.InterfaceDeclaration {
    return (declaration as any).kind === 'interface';
}

function isDtsTopLevelDeclaration(declaration: dtsdom.DeclarationBase): declaration is dtsdom.TopLevelDeclaration {
    return (declaration as any).kind !== 'property' &&
    (declaration as any).kind !== 'method';
}

function syntaxKindToString(syntaxKind: ts.SyntaxKind) {
    const keys = Object.keys(ts.SyntaxKind).filter((key) => (ts.SyntaxKind as any)[key] === syntaxKind);
    return keys.join(' or ');
}

function symbolFlagToString(symbolFlag: ts.SymbolFlags) {
    const keys = Object.keys(ts.SymbolFlags).filter((key) => {
        const flg = (ts.SymbolFlags as any)[key];
        if (flg === 0) {
            return false;
        }
        if ((flg & symbolFlag) === flg) {
            return true;
        }
        return false;
    });
    return keys.join(' and ');
}