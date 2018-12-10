
import * as dtsdom from './dts-dom';
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import mkdirp = require('mkdirp');

export interface EmitterOtions
{
    inputs: string[];
    outputDir: string;
    excludes: string[];
    sourceRoot: string;
}

class SymbolInfo {
    parent: SymbolInfo | null = null;

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

    private _exported: Set<ts.Symbol> = new Set();

    private _namespacesLog: string[] = [];

    private _modulesImpl: dtsdom.NamespaceDeclaration;

    private _parentMap: dtsdom.ParentMap = new Map();

    constructor(private _options: EmitterOtions) {
        const rootNames: string[] = [];
        const addFile = (filePath: string) => {
            if (this._isExcluded(filePath)) {
                return;
            }
            rootNames.push(filePath);
        };
        _options.inputs.forEach((input) => {
            const stat = fs.statSync(input);
            if (stat.isFile()) {
                addFile(path.normalize(input));
            } else {
                iterateOverDirectory(input, (filePath) => {
                    const normalized = path.normalize(filePath);
                    if (normalized.endsWith('.js')) {
                        addFile(normalized);
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

        this._modulesImpl = dtsdom.create.namespace('__unpacked');
        this._parentMap.set(this._modulesImpl, {
            fullPath: this._modulesImpl.name
        });

        const sourceFiles = program.getSourceFiles();
        sourceFiles.forEach((sourceFile) => {
            const n = path.normalize(sourceFile.fileName);
            if (n.startsWith(path.normalize(_options.sourceRoot))) {
                // DO IT: Should we use program.isSourceFileDefaultLibrary(sourceFile) && program.isSourceFileFromExternalLibrary(sourceFile)?
                this._processSourceFile(sourceFile);
            }
        });
    }

    emit() {
        let output = '';

        // this._symbols.forEach((symbolInfo) => {
        //     if (!symbolInfo.resolved) {
        //         return;
        //     }
        //     if (!isDtsTopLevelDeclaration(symbolInfo.dtsDeclaration)) {
        //         return;
        //     }
        //     if (symbolInfo.parent !== null) {
        //         return;
        //     }
        //     output += dtsdom.emit(symbolInfo.dtsDeclaration);
        // });
        this._exported.forEach((exported) => {
            const symbolInfo = this._getSymbolInfo(exported);
            if (!symbolInfo.resolved) {
                return;
            }
            if (!isDtsTopLevelDeclaration(symbolInfo.dtsDeclaration)) {
                return;
            }
            if (symbolInfo.parent !== null) {
                return;
            }
            output += dtsdom.emit(symbolInfo.dtsDeclaration, this._parentMap);
        });

        output += dtsdom.emit(this._modulesImpl, this._parentMap);

        const outputPath = path.join(this._options.outputDir, 'cocos-creator-3d.d.ts');
        const outputFileDir = path.dirname(outputPath);
        if (!fs.existsSync(outputFileDir)) {
            mkdirp.sync(outputFileDir);
        }
        fs.writeFileSync(outputPath, output);

        fs.writeFileSync(path.join(this._options.outputDir, 'namespaces.log'), this._namespacesLog.join('\n'));
    }

    private _processSourceFile(sourceFile: ts.SourceFile) {
        const symbol = this._typeChecker.getSymbolAtLocation(sourceFile);
        if (symbol) {
            this._resolveSymbol(symbol);
        } else {
            console.warn(`Source file ${sourceFile.fileName} has no symbol.`);
        }
    }

    private _getSourceFileRelativePath(sourceFile: ts.SourceFile) {
        return path.normalize(path.relative(this._options.sourceRoot, sourceFile.fileName));
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
        }
        return symbolInfo;
    }

    private _printSymbolAst(symbol: ts.Symbol) {
        const declaration = symbol.valueDeclaration || symbol.declarations[0];
        if (ts.isSourceFile(declaration)) {
            return declaration.fileName;
        }
        let text = declaration.getText();
        if (testSymbolFlags(symbol.flags, ts.SymbolFlags.Assignment) && ts.isPropertyAccessExpression(declaration)) {
            text = declaration.parent.getText();
        }
        const maxLine = 3;
        let lines = text.split('\n');
        if (lines.length > maxLine) {
            lines = lines.slice(0, maxLine);
            lines.push('...');
        }
        return lines.join('\n') + `(${declaration.getSourceFile().fileName})(${syntaxKindToString(declaration.kind)})`;
    }

    private _resolveSymbol(symbol: ts.Symbol): SymbolInfo {
        console.log(`** Resolving symbol ${symbol.name}\n` +
            `flags: ${symbolFlagToString(symbol.flags)}\n` +
            `ast: ${this._printSymbolAst(symbol)}\n`);

        const symbolFlags = symbol.getFlags();

        if (symbolFlags === ts.SymbolFlags.ValueModule) {
            // It's a module
            if (!ts.isSourceFile(symbol.valueDeclaration)) {
                throw new Error(`Unexpected.`);
            }
            return this._resolveFileModuleSymbol(symbol);
        }

        if (testSymbolFlags(symbolFlags, ts.SymbolFlags.Class)) {
            return this._resolveClassSymbol(symbol);
        }
        
        else if (testSymbolFlags(symbolFlags, ts.SymbolFlags.Function)) {
            return this._resolveFunctionSymbol(symbol);
        }
        
        else if (testSymbolFlags(symbolFlags, ts.SymbolFlags.Namespace)) {
            if (testSymbolFlags(symbolFlags, ts.SymbolFlags.Enum)) {
                return this._resolveEnumSymbol(symbol);
            } else {
                this._namespacesLog.push(`Namespace ${this._resolveSymbolName(symbol)} flags: ${symbolFlagToString(symbolFlags)}`);
                const dtsNamespace = dtsdom.create.namespace(this._resolveSymbolName(symbol));
                if (dtsNamespace.name.includes('/')) {
                    //debugger;
                }
                if (ts.isSourceFile(symbol.valueDeclaration || symbol.declarations[0])) {
                    //debugger;
                }
                return this._addSymbolInfo(symbol, dtsNamespace);
            }
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
            return this._resolveAccessorSymbol(symbol);
        }
        
        else if (testSymbolFlags(symbolFlags, ts.SymbolFlags.Alias)) {
            return this._resolveAliasSymbol(symbol);
        }

        else if (testSymbolFlags(symbolFlags, ts.SymbolFlags.TypeAlias)) {
            return this._resolveTypeAliasSymbol(symbol);
        }
        
        else if (testSymbolFlags(symbolFlags, ts.SymbolFlags.Prototype)) {

        }
        
        else if (testSymbolFlags(symbolFlags, ts.SymbolFlags.BlockScopedVariable) ||
            testSymbolFlags(symbolFlags, ts.SymbolFlags.FunctionScopedVariable)) {
            // Block scoped variables and function scoped variables are ignored
        }
        
        else {
            const decl = symbol.valueDeclaration || symbol.declarations[0];
            console.error(`Unprocessed symbol with flags: ${symbolFlagToString(symbol.flags)}, node: ${decl.getText()}(kind: ${syntaxKindToString(decl.kind)})`);
            //debugger;
        }

        return this._addSymbolInfo(symbol);
    }

    private _addSymbolInfo(symbol: ts.Symbol, dtsDeclaration?: dtsdom.DeclarationBase) {
        const result = new SymbolInfo(dtsDeclaration);
        this._symbols.set(symbol, result);
        return result;
    }

    private _resolveFileModuleSymbol(symbol: ts.Symbol) {
        const astNode = symbol.valueDeclaration;
        if (!astNode || !ts.isSourceFile(astNode)) {
            throw new Error(`Unexpected.`);
        }

        const relativePath = this._getSourceFileRelativePath(astNode);
        const segments = relativePath.split(path.sep);
        let currentNamespace = this._modulesImpl;
        segments.forEach(segment => {
            const name = this._getFileModuleName(segment);
            let member = currentNamespace.members.find(member => member.name === name);
            if (member === undefined) {
                member = dtsdom.create.namespace(name);
                currentNamespace.members.push(member);
                this._parentMap.set(member, {
                    directParent: currentNamespace,
                    fullPath: this._getFullNamespacePath(currentNamespace) + `.${name}`
                });
            }
            currentNamespace = member as dtsdom.NamespaceDeclaration;
        });

        const symbolInfo = this._addSymbolInfo(symbol, currentNamespace);
        this._resolveExports(symbol, symbolInfo);
        return symbolInfo;
    }

    private _resolveExports(parentSymbol: ts.Symbol, parentSymbolInfo: SymbolInfo) {
        const parentDeclaration = parentSymbolInfo.dtsDeclaration as dtsdom.NamespaceDeclaration;
        let namespaceSymbol = parentSymbol;
        if (testSymbolFlags(parentSymbol.flags, ts.SymbolFlags.Alias)) {
            namespaceSymbol = this._typeChecker.getAliasedSymbol(namespaceSymbol);
        }
        const exportSymbols = this._typeChecker.getExportsOfModule(namespaceSymbol);
        exportSymbols.forEach(exportSymbol => {
            const exportSymbolInfo = this._getSymbolInfo(exportSymbol);
            if (exportSymbolInfo.resolved) {
                exportSymbolInfo.parent = parentSymbolInfo!;
                parentDeclaration.members.push(exportSymbolInfo.dtsDeclaration);
                this._parentMap.set(exportSymbolInfo.dtsDeclaration, {
                    directParent: parentDeclaration,
                    fullPath: this._getFullNamespacePath(parentDeclaration) + `.${exportSymbolInfo.dtsDeclaration.name}`
                });
            }
        });
    }


    private _getFullNamespacePath(namespaceDeclaration: dtsdom.NamespaceDeclaration) {
        const info = this._parentMap.get(namespaceDeclaration);
        if (!info) {
            return '';
        } else {
            return info.fullPath;
        }
    }

    private _resolveMembers(parentSymbol: ts.Symbol, parentSymbolInfo: SymbolInfo) {
        if (!parentSymbol.members) {
            return;
        }
        const namespaceOrClassDecl = parentSymbolInfo!.dtsDeclaration;
        parentSymbol.members.forEach((memberSymbol) => {
            const memberSymbolInfo = this._getSymbolInfo(memberSymbol);
            if (memberSymbolInfo.resolved) {
                memberSymbolInfo.parent = parentSymbolInfo!;
                if (isDtsNamespaceDeclaration(namespaceOrClassDecl)) {
                    namespaceOrClassDecl.members.push(memberSymbolInfo.dtsDeclaration);
                } else if (isDtsClassDeclaration(namespaceOrClassDecl)) {
                    namespaceOrClassDecl.members.push(memberSymbolInfo.dtsDeclaration);
                }
            }
        });
    }

    private _getFileModuleName(fileName: string) {
        return `__${fileName.replace(/\./g, '_').replace(/-/g, '_')}`;
    }

    private _resolveClassSymbol(symbol: ts.Symbol) {
        const astNode = symbol.valueDeclaration;
        if (!astNode || !ts.isClassDeclaration(astNode)) {
            return this._addSymbolInfo(symbol);
        }

        const dtsClassDecl = dtsdom.create.class(this._resolveSymbolName(symbol));

        if (astNode.heritageClauses) {
            astNode.heritageClauses.forEach((heritage) => {
                this._resolveDTSHeritage(dtsClassDecl, heritage);
            });
        }

        const result = this._addSymbolInfo(symbol, dtsClassDecl);
        this._resolveMembers(symbol, result);
        return result;
    }

    private _resolveEnumSymbol(symbol: ts.Symbol) {
        const astNode = symbol.valueDeclaration;
        if (!astNode) {
            return this._addSymbolInfo(symbol);
        }

        const dtsEnum = dtsdom.create.enum(this._resolveSymbolName(symbol));

        return this._addSymbolInfo(symbol, dtsEnum);
    }

    private _resolveConstructorSymbol(symbol: ts.Symbol) {
        const astNode = symbol.valueDeclaration;
        if (!astNode || !ts.isConstructorDeclaration(astNode)) {
            return this._addSymbolInfo(symbol);
        }

        const dtsCtorDecl = dtsdom.create.constructor(
            this._makeDTSParams(astNode)
        );

        return this._addSymbolInfo(symbol, dtsCtorDecl);
    }

    private _resolveFunctionSymbol(symbol: ts.Symbol) {
        const astNode = symbol.valueDeclaration;
        if (!astNode || !ts.isFunctionDeclaration(astNode)) {
            return this._addSymbolInfo(symbol);
        }

        const func = dtsdom.create.function(this._resolveSymbolName(symbol), this._makeDTSParams(astNode), this._makeDTSReturnType(astNode));
        return this._addSymbolInfo(symbol, func);
    }

    private _resolveTypeAliasSymbol(symbol: ts.Symbol) {
        const astNode = symbol.declarations[0];
        if (!astNode) {
            return this._addSymbolInfo(symbol);
        }

        let type: dtsdom.Type | null = null;
        if (ts.isTypeAliasDeclaration(astNode)) {
            type = this._typeNodeToDTSdomType(astNode.type);
        } else if (ts.isJSDocTypedefTag(astNode)) {
            type = astNode.typeExpression ? this._typeNodeToDTSdomType(astNode.typeExpression) : dtsdom.type.any;
        }

        if (type) {
            const alias = dtsdom.create.alias(symbol.name, type);
            return this._addSymbolInfo(symbol, alias);
        }

        return this._addSymbolInfo(symbol);
    }

    private _resolveAliasSymbol(symbol: ts.Symbol) {
        if (symbol.name === 'default') {
            //debugger;
        }

        const originalSymbol = this._typeChecker.getAliasedSymbol(symbol);
        const originalSymbolInfo = this._getSymbolInfo(originalSymbol);
        if (originalSymbolInfo.resolved) {
            const declaration = originalSymbolInfo.dtsDeclaration;
            if (isDtsClassDeclaration(declaration)) {
                const alias = dtsdom.create.alias(this._resolveSymbolName(symbol), declaration);
                return this._addSymbolInfo(symbol, alias);
            } else {
                return this._addSymbolInfo(symbol, copyDtsDeclaration(declaration, symbol.name));
            }
        }

        return this._addSymbolInfo(symbol);
    }

    private _resolvePropertySymbol(symbol: ts.Symbol) {
        const astNode = symbol.valueDeclaration;
        if (!astNode) {
            return this._addSymbolInfo(symbol);
        }

        if (symbol.name === '_decorator') {
            //debugger;
        }

        if (ts.isPropertyDeclaration(astNode)) {
            const property = this._createDataMember(symbol, this._tryResolveTypeTag(astNode));
            return this._addSymbolInfo(symbol, property);
        }

        else if (testSymbolFlags(symbol.flags, ts.SymbolFlags.Assignment)) {
            console.log(`Processing property symbol ${astNode.getText()}(with kind ${syntaxKindToString(astNode.kind)})`);
            if (ts.isBinaryExpression(astNode.parent)) {
                return this._getAssignmentExprSymbol(symbol, astNode.parent.right, symbol.name);
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

        return this._addSymbolInfo(symbol);
    }

    /**
     * Creates class member or namespace member.
     * @param symbol 
     * @param type 
     */
    private _createDataMember(symbol: ts.Symbol, type: dtsdom.Type) {
        const parent = (symbol as any).parent as ts.Symbol;
        if (!parent) {
            throw new Error(`Member should have parent`);
        }
        if (testSymbolFlags(parent.flags, ts.SymbolFlags.Class)) {
            return dtsdom.create.property(symbol.name, type);
        } else if (testSymbolFlags(parent.flags, ts.SymbolFlags.Namespace) ||
            testSymbolFlags(parent.flags, ts.SymbolFlags.ObjectLiteral)) {
            return dtsdom.create.variable(symbol.name, type);
        } else {
            throw new Error(`Unknown parent kind ${symbolFlagToString(parent.flags)}.`);
        }
    }

    private _createFunctionMember(symbol: ts.Symbol, parameters: Array<dtsdom.Parameter>, returnType: dtsdom.Type) {
        const parent = (symbol as any).parent as ts.Symbol;
        if (!parent) {
            throw new Error(`Member should have parent`);
        }
        if (testSymbolFlags(parent.flags, ts.SymbolFlags.Class)) {
            return dtsdom.create.method(symbol.name, parameters, returnType);
        } else if (testSymbolFlags(parent.flags, ts.SymbolFlags.Namespace) ||
            testSymbolFlags(parent.flags, ts.SymbolFlags.ObjectLiteral)) {
            return dtsdom.create.function(symbol.name, parameters, returnType);
        } else {
            console.error(`Unknown parent kind ${symbolFlagToString(parent.flags)}.`);
        }
    }

    private _getAssignmentExprSymbol(symbol: ts.Symbol, valueExpr: ts.Expression, name: string) {
        if (ts.isObjectLiteralExpression(valueExpr)) {
            const namespaceDecl = dtsdom.create.namespace(symbol.name);
            const result = this._addSymbolInfo(symbol, namespaceDecl);
            valueExpr.properties.forEach(property => {
                if (property.name) {
                    const memberSymbol = this._typeChecker.getSymbolAtLocation(property.name);
                    if (memberSymbol) {
                        const member = this._getSymbolInfo(memberSymbol);
                        if (member.resolved) {
                            member.parent = result;
                            namespaceDecl.members.push(member.dtsDeclaration);
                        }
                    }
                }
            });
            return result;
        } else {
            const memberSymbol = this._typeChecker.getSymbolAtLocation(valueExpr);
            if (memberSymbol) {
                const valueSymbolInfo = this._getSymbolInfo(memberSymbol);
                if (valueSymbolInfo.resolved) {
                    const valueDeclaration = valueSymbolInfo.dtsDeclaration;
                    if (isDtsClassDeclaration(valueDeclaration)) {
                        const alias = dtsdom.create.alias(name, valueDeclaration);
                        this._exported.add(memberSymbol);
                        return this._addSymbolInfo(symbol, alias);
                    } else {
                        return this._addSymbolInfo(symbol, copyDtsDeclaration(valueSymbolInfo.dtsDeclaration, name));
                    }
                }
            }
        }
        return this._addSymbolInfo(symbol);
    }

    private _resolveMethodSymbol(symbol: ts.Symbol) {
        const astNode = symbol.valueDeclaration;
        if (!astNode) {
            return this._addSymbolInfo(symbol);
        }

        if (ts.isMethodDeclaration(astNode) ||
            ts.isMethodSignature(astNode)) {
            return this._addSymbolInfo(symbol,
                this._createFunctionMember(symbol, this._makeDTSParams(astNode), this._makeDTSReturnType(astNode)));
        }

        else if (ts.isPropertyAccessExpression(astNode)) {
            const functionExpression = (astNode.parent as ts.BinaryExpression).right as ts.FunctionExpression;
            return this._addSymbolInfo(symbol,
                this._createFunctionMember(symbol, this._makeDTSParams(functionExpression), this._makeDTSReturnType(functionExpression)));
        }

        else {
            console.error(`Cannot resolve method from ${astNode.getText()} ` +
                `(with kind ${syntaxKindToString(astNode.kind)}, flags: ${symbolFlagToString(symbol.flags)}).`);
            debugger;
        }
        
        return this._addSymbolInfo(symbol);
    }

    private _resolveAccessorSymbol(symbol: ts.Symbol) {
        const astNode = symbol.valueDeclaration;
        if (!astNode || !ts.isAccessor(astNode)) {
            return this._addSymbolInfo(symbol);
        }

        // Accessor symbol
        let isReadOnly = true;
        if (testSymbolFlags(symbol.flags, ts.SymbolFlags.SetAccessor)) {
            isReadOnly = false;
        }

        if (!((symbol as any).parent & ts.SymbolFlags.Class)) {
            // Maybe ObjectLiteral
            // debugger;
        }

        let flags: dtsdom.DeclarationFlags = 0;
        if (isReadOnly) {
            flags |= dtsdom.DeclarationFlags.ReadOnly;
        }

        return this._addSymbolInfo(symbol, this._createDataMember(symbol, this._tryResolveTypeTag(astNode)));
    }

    private _resolveDTSHeritage(dtsClassDecl: dtsdom.ClassDeclaration, heritage: ts.HeritageClause) {
        heritage.types.forEach((heritageType) => {
            if (dtsClassDecl.name === 'Node') {
                //debugger;
            }
            const type = this._typeChecker.getTypeAtLocation(heritageType);
            let typeSymbol = type.getSymbol();
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

    private _resolveSymbolName(symbol: ts.Symbol) {
        const name = (() => {
            if (symbol.valueDeclaration) {
                const valueDeclaration = symbol.valueDeclaration;
                if ((ts.isClassDeclaration(valueDeclaration) ||
                    ts.isFunctionDeclaration(valueDeclaration)) && valueDeclaration.name) {
                    return valueDeclaration.name.getText();
                }
            }

            return symbol.name;
        })();
        return name === 'default' ? '__default' : name;
    }

    /** True if this is visible outside this file, false otherwise */
    private _isNodeExported(node: ts.Declaration): boolean {
        return (
            (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export) !== 0 ||
            (!!node.parent && node.parent.kind === ts.SyntaxKind.SourceFile)
        );
    }

    private _makeDTSReturnType(astNode: ts.FunctionLike) {
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

    private _makeDTSParams(astNode: ts.FunctionLike) {
        const paramTags = ts.getAllJSDocTagsOfKind(astNode, ts.SyntaxKind.JSDocParameterTag) as ts.JSDocParameterTag[];
        return astNode.parameters.map((param) => {
            const paramName = param.name.getText();
            const paramTag = paramTags.find((paramTag) => paramTag.name.getText() === paramName) as ts.JSDocParameterTag;

            let type: dtsdom.Type = dtsdom.type.any;
            if (paramTag !== undefined && paramTag.typeExpression) {
                type = this._typeNodeToDTSdomType(paramTag.typeExpression.type);
            }

            let flags: dtsdom.ParameterFlags = 0;
            if (param.questionToken) {
                flags |= dtsdom.ParameterFlags.Optional;
            }
            return dtsdom.create.parameter(paramName, type, flags);
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
                    const nameAST = propertyTag.name;
                    let name = nameAST.getText();
                    if (ts.isQualifiedName(nameAST)) {
                        name = nameAST.right.getText();
                    }
                    dtsmembers.push(dtsdom.create.property(
                        name, propertyTag.typeExpression ?this._typeNodeToDTSdomType(propertyTag.typeExpression) : dtsdom.type.any,
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

function copyDtsDeclaration(declaration: dtsdom.TopLevelDeclaration, newName: string): dtsdom.TopLevelDeclaration {
    const result = Object.assign({}, declaration);
    result.name = newName;
    return result;
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