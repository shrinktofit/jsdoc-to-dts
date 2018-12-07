
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
            symbolInfo = this._resolveSymbol(symbol);
            this._symbols.set(symbol, symbolInfo);

            if (symbolInfo && symbolInfo.resolved) {
                // Resolves members
                if (symbol.members) {
                    const namespaceOrClassDecl = symbolInfo!.dtsDeclaration;
                    symbol.members.forEach((memberSymbol) => {
                        const memberSymbolInfo = this._getSymbolInfo(memberSymbol);
                        if (memberSymbolInfo.resolved) {
                            if (isDtsNamespaceDeclaration(namespaceOrClassDecl)) {
                                namespaceOrClassDecl.members.push(memberSymbolInfo.dtsDeclaration);
                            } else if (isDtsClassDeclaration(namespaceOrClassDecl)) {
                                namespaceOrClassDecl.members.push(memberSymbolInfo.dtsDeclaration);
                            }
                        }
                    });
                }

                // Resolves exports
                if (isDtsNamespaceDeclaration(symbolInfo.dtsDeclaration) && testSymbolFlags(symbol.flags, ts.SymbolFlags.Module)) {
                    const namespaceDecl = symbolInfo.dtsDeclaration;
                    if (!isDtsNamespaceDeclaration(namespaceDecl)) {
                        throw new Error(`${symbol.name} has exports, but it isn't a namespace.`);
                    }
                    let namespaceSymbol = symbol;
                    if (testSymbolFlags(symbol.flags, ts.SymbolFlags.Alias)) {
                        namespaceSymbol = this._typeChecker.getAliasedSymbol(namespaceSymbol);
                    }
                    const exportSymbols = this._typeChecker.getExportsOfModule(namespaceSymbol);
                    exportSymbols.forEach(exportSymbol => {
                        const exportSymbolInfo = this._getSymbolInfo(exportSymbol);
                        if (exportSymbolInfo.resolved) {
                            namespaceDecl.members.push(exportSymbolInfo.dtsDeclaration);
                        }
                    });
                }
            }
        }
        return symbolInfo;
    }

    private _resolveSymbol(symbol: ts.Symbol): SymbolInfo {
        const declaration = symbol.valueDeclaration || symbol.declarations[0];

        console.log(`Resolving symbol ${symbol.name}, ` +
            `flags: ${symbolFlagToString(symbol.flags)}, ` +
            `ast: ${declaration.getText().substr(0, 10)}`);

        const symbolFlags = symbol.getFlags();

        // if (symbol.name === 'Mesh') {
        //     debugger;
        // }

        if (testSymbolFlags(symbolFlags, ts.SymbolFlags.Class)) {
            return this._resolveClassSymbol(symbol);
        }
        
        else if (testSymbolFlags(symbolFlags, ts.SymbolFlags.Function)) {
            return this._resolveFunctionSymbol(symbol);
        }
        
        else if (testSymbolFlags(symbolFlags, ts.SymbolFlags.Namespace)) {
            const dtsNamespace = dtsdom.create.namespace(ts.symbolName(symbol));
            if (ts.isSourceFile(symbol.valueDeclaration || symbol.declarations[0])) {
                //debugger;
            }
            return new SymbolInfo(dtsNamespace);
        }
        
        else if (testSymbolFlags(symbolFlags, ts.SymbolFlags.Module)) {
            debugger;
        }

        else if (testSymbolFlags(symbolFlags, ts.SymbolFlags.Constructor)) {
            return this._resolveConstructorSymbol(symbol);
        }                                                                                                                                                                                                         
        
        else if (testSymbolFlags(symbolFlags, ts.SymbolFlags.Property)) {
            return this._resolvePropertySymbol(symbol);
        }
        
        else if (testSymbolFlags(symbolFlags, ts.SymbolFlags.Method)) {
            return this._resolveMethodSymbol(symbol);                                                                                                                                                                 
        }
        
        else if (testSymbolFlags(symbolFlags, ts.SymbolFlags.Accessor)) {
            // Accessor symbol
            let isReadOnly = true;
            if (testSymbolFlags(symbolFlags, ts.SymbolFlags.SetAccessor)) {
                isReadOnly = false;
            }
            if (!((symbol as any).parent & ts.SymbolFlags.Class)) {
                //debugger;
            }
            return new SymbolInfo(this._makeDTSAccessor(symbol, symbol.valueDeclaration as ts.AccessorDeclaration, !isReadOnly));
        }
        
        else if (testSymbolFlags(symbolFlags, ts.SymbolFlags.Alias)) {
            const originalSymbol = this._typeChecker.getAliasedSymbol(symbol);
            if (symbol.name === '_decorator') {
                //debugger;
            }
            return this._getSymbolInfo(originalSymbol);
        }
        
        else if (symbolFlags & ts.SymbolFlags.Prototype) {

        }
        
        else if (testSymbolFlags(symbolFlags, ts.SymbolFlags.BlockScopedVariable) ||
            testSymbolFlags(symbolFlags, ts.SymbolFlags.FunctionScopedVariable)) {
            // Block scoped variables and function scoped variables are ignored
        }
        
        else {
            const decl = symbol.valueDeclaration || symbol.declarations[0];
            console.error(`Unprocessed symbol with flags: ${symbolFlagToString(symbol.flags)}, node: ${decl.getText()}(kind: ${syntaxKindToString(decl.kind)})`);
            debugger;
        }
        return new SymbolInfo();
    }

    private _resolveClassSymbol(symbol: ts.Symbol) {
        const astNode = symbol.valueDeclaration;
        if (!astNode || !ts.isClassDeclaration(astNode)) {
            return new SymbolInfo();
        }

        const dtsClassDecl = dtsdom.create.class(symbol.name);

        if (astNode.heritageClauses) {
            astNode.heritageClauses.forEach((heritage) => {
                this._resolveDTSHeritage(dtsClassDecl, heritage);
            });
        }

        return new SymbolInfo(dtsClassDecl);
    }

    private _resolveConstructorSymbol(symbol: ts.Symbol) {
        const astNode = symbol.valueDeclaration;
        if (!astNode || !ts.isConstructorDeclaration(astNode)) {
            return new SymbolInfo();
        }

        const dtsCtorDecl = dtsdom.create.constructor(
            this._makeDTSParams(astNode)
        );

        return new SymbolInfo(dtsCtorDecl);
    }

    private _resolveFunctionSymbol(symbol: ts.Symbol) {
        const astNode = symbol.valueDeclaration;
        if (!astNode || !ts.isFunctionDeclaration(astNode)) {
            return new SymbolInfo();
        }

        const func = dtsdom.create.function(symbol.name, this._makeDTSParams(astNode), this._makeDTSReturnType(astNode));
        return new SymbolInfo(func);
    }

    private _resolvePropertySymbol(symbol: ts.Symbol) {
        const astNode = symbol.valueDeclaration;
        if (!astNode) {
            return new SymbolInfo();
        }

        if (ts.isPropertyDeclaration(astNode)) {
            const property = this._createDTSMember(symbol, this._tryResolveTypeTag(astNode));
            return new SymbolInfo(property);
        }

        else if (testSymbolFlags(symbol.flags, ts.SymbolFlags.Assignment)) {
            console.log(`Processing property symbol ${astNode.getText()}(with kind ${syntaxKindToString(astNode.kind)})`);
            if (ts.isBinaryExpression(astNode.parent)) {
                return this._getAssignmentExprSymbol(symbol, astNode.parent.right);
            }
        }
        
        else if (ts.isPropertyAssignment(astNode)) {

        }
        
        else if (ts.isPropertySignature(astNode)) {

        }
        
        else if (ts.isExportAssignment(astNode)) {

        }
        
        else if (ts.isShorthandPropertyAssignment(astNode)) {
            const valueSymbol = this._typeChecker.getShorthandAssignmentValueSymbol(symbol.valueDeclaration);
            if (valueSymbol) {
                return this._getSymbolInfo(valueSymbol);
            }
        }
        
        else {
            console.error(`Cannot resolve property from ${astNode.getText()} ` +
                `(with kind ${syntaxKindToString(astNode.kind)}, flags: ${symbolFlagToString(symbol.flags)}).`);
        }

        return new SymbolInfo();
    }

    /**
     * Creates class member or namespace member.
     * @param symbol 
     * @param type 
     */
    private _createDTSMember(symbol: ts.Symbol, type: dtsdom.Type) {
        const parent = (symbol as any).parent as ts.Symbol;
        if (!parent) {
            throw new Error(`Member should have parent`);
        }
        if (testSymbolFlags(parent.flags, ts.SymbolFlags.Class) ||
            testSymbolFlags(parent.flags, ts.SymbolFlags.ObjectLiteral)) {
            return dtsdom.create.property(symbol.name, type);
        } else if (testSymbolFlags(parent.flags, ts.SymbolFlags.Namespace)) {
            return dtsdom.create.variable(symbol.name, type);
        } else {
            throw new Error(`Unknown parent kind ${symbolFlagToString(parent.flags)}.`);
        }
    }

    private _getAssignmentExprSymbol(symbol: ts.Symbol, valueExpr: ts.Expression) {
        if (ts.isObjectLiteralExpression(valueExpr)) {
            const namespaceDecl = dtsdom.create.namespace(symbol.name);
            valueExpr.properties.forEach(property => {
                if (property.name) {
                    const memberSymbol = this._typeChecker.getSymbolAtLocation(property.name);
                    if (memberSymbol) {
                        const member = this._getSymbolInfo(memberSymbol);
                        if (member.resolved) {
                            namespaceDecl.members.push(member.dtsDeclaration);
                        }
                    }
                }
            });
            return new SymbolInfo(namespaceDecl);
        } else {
            const memberSymbol = this._typeChecker.getSymbolAtLocation(valueExpr);
            if (memberSymbol) {
                return this._getSymbolInfo(memberSymbol);
            }
        }
        return new SymbolInfo();
    }

    private _resolveMethodSymbol(symbol: ts.Symbol) {
        const astNode = symbol.valueDeclaration;
        if (!astNode) {
            return new SymbolInfo();
        }

        if (ts.isMethodDeclaration(astNode)) {
            const method = dtsdom.create.method(symbol.name, this._makeDTSParams(astNode), this._makeDTSReturnType(astNode));
            return new SymbolInfo(method);
        }

        else if (ts.isMethodSignature(astNode)) {
            const method = dtsdom.create.method(symbol.name, this._makeDTSParams(astNode), this._makeDTSReturnType(astNode));
            return new SymbolInfo(method);
        }

        else if (ts.isPropertyAccessExpression(astNode)) {
            const functionExpression = (astNode.parent as ts.BinaryExpression).right as ts.FunctionExpression;
            const method = dtsdom.create.method(symbol.name, this._makeDTSParams(functionExpression), this._makeDTSReturnType(functionExpression));
            return new SymbolInfo(method);
        }

        else {
            console.error(`Cannot resolve method from ${astNode.getText()} ` +
                `(with kind ${syntaxKindToString(astNode.kind)}, flags: ${symbolFlagToString(symbol.flags)}).`);
            debugger;
        }
        
        return new SymbolInfo();
    }

    private _processSourceFile(sourceFile: ts.SourceFile, relativePath: string) {
        //console.log(`Processing ${sourceFile.fileName}`);
        //this._processNode(sourceFile);
    }

    private _makeDTSAccessor(symbol: ts.Symbol, astNode: ts.AccessorDeclaration, hasSetter: boolean) {
        let flags: dtsdom.DeclarationFlags = 0;
        if (!hasSetter) {
            flags |= dtsdom.DeclarationFlags.ReadOnly;
        }
        return this._createDTSMember(symbol, this._tryResolveTypeTag(astNode), flags);
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
                    console.error(`${dtsClassDecl.name}'s hieritage ` +
                        `${heritage.getText()} shall be resolved to a class, but it's a ${getDtsDeclarationKind(symbolInfo.dtsDeclaration)}.`);
                }
            } else {
                if (isDtsInterfaceDeclaration(symbolInfo.dtsDeclaration)) {
                    dtsClassDecl.baseType = symbolInfo.dtsDeclaration;
                } else {
                    console.error(`${dtsClassDecl.name}'s hieritage ` +
                        `${heritage.getText()} shall be resolved to an interface, but it's a ${getDtsDeclarationKind(symbolInfo.dtsDeclaration)}.`);
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

    private _makeDTSParams(astNode: ts.MethodDeclaration | ts.FunctionDeclaration | ts.ConstructorDeclaration | ts.FunctionExpression | ts.MethodSignature) {
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

    private _tryResolveTypeTag(astNode: ts.AccessorDeclaration | ts.PropertyDeclaration | ts.FunctionExpression | ts.MethodSignature) {
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
    return getDtsDeclarationKind(declaration) === 'class';
}

function isDtsInterfaceDeclaration(declaration: dtsdom.DeclarationBase): declaration is dtsdom.InterfaceDeclaration {
    return getDtsDeclarationKind(declaration) === 'interface';
}

function isDtsNamespaceDeclaration(declaration: dtsdom.DeclarationBase): declaration is dtsdom.NamespaceDeclaration {
    return getDtsDeclarationKind(declaration) === 'namespace';
}

function isDtsTopLevelDeclaration(declaration: dtsdom.DeclarationBase): declaration is dtsdom.TopLevelDeclaration {
    return (declaration as any).kind !== 'property' &&
    (declaration as any).kind !== 'method';
}

function getDtsDeclarationKind(declaration: dtsdom.DeclarationBase): string | undefined {
    return (declaration as any).kind;
}

function syntaxKindToString(syntaxKind: ts.SyntaxKind) {
    const keys = Object.keys(ts.SyntaxKind).filter((key) => (ts.SyntaxKind as any)[key] === syntaxKind);
    return keys.join(' or ');
}

function testSymbolFlags(test: ts.SymbolFlags, symbolFlags: ts.SymbolFlags) {
    return (test & symbolFlags);
}

function symbolFlagToString(symbolFlag: ts.SymbolFlags) {
    const keys = Object.keys(ts.SymbolFlags).filter((key) => {
        const flg = (ts.SymbolFlags as any)[key] as number;
        if (oneBitIsSet(flg)) {
            return (flg & symbolFlag) !== 0;
        }
        return false;
    });
    return keys.join(', ');
}

function oneBitIsSet(n: number) {
    return n !== 0 && (n & (n - 1)) === 0;
}