declare module "jsdoc-api" {
  interface JsdocOptions {
    destination: string;
    private: boolean;
  }

  interface ITemplates {
    jsdoc2tsd: JsdocOptions;
  }

  interface IConf {
    templates: ITemplates;
  }

  export const conf: IConf;

  interface IDocletType {
    names: string[];
  }

  interface IDocletProp {
    type: IDocletType;
    name: string;
    description: string;
    comment: string;
    defaultvalue?: string;
    meta?: any;
    optional?: boolean;
    variable?: boolean;
  }

  interface IDocletReturn {
    type: IDocletType;
    description: string;
  }

  interface IDocletCode {
    id: string;
    name: string;
    type: string;
    value?: string;
    paramnames?: string[];
  }

  interface IDocletMeta {
    range: number[];
    filename: string;
    lineno: number;
    path: string;
    code: IDocletCode;
  }

  interface IDocletTag {
    originalTitle: string;
    title: string;
    text: string;
    value: string;
  }

  interface IDocletBase {
    meta: IDocletMeta;
    name: string;
    scope: string;
    longname: string;
    variation?: string;
    tags?: IDocletTag[];
    memberof?: string;
    see?: string;
    access?: "public" | "private" | "protected";
    examples?: string;
    deprecated?: string;
    defaultvalue?: string;
    comment?: string;
    description?: string;
    ignore?: boolean;
    undocumented?: boolean;
    properties?: IDocletProp[];
    inherited?: boolean;
  }

  interface IClassDoclet extends IDocletBase {
    kind: "class" | "interface" | "mixin";
    params?: IDocletProp[];
    augments?: string[];
    implements?: string[];
    mixes?: string[];
    virtual?: boolean;
    classdesc?: string;
  }

  interface IFunctionDoclet extends IDocletBase {
    kind: "function";
    params?: IDocletProp[];
    returns?: IDocletReturn[];
    override?: boolean;
    virtual?: string[];
  }

  interface IMemberDoclet extends IDocletBase {
    kind: "member" | "constant";
    readonly: boolean;
    isEnum: boolean;
    type: IDocletType;
  }

  interface INamespaceDoclet extends IDocletBase {
    kind: "namespace" | "module";
  }

  interface ITypedefDoclet extends IDocletBase {
    kind: "typedef";
    type: IDocletType;

    params?: IDocletProp[];
    returns?: IDocletReturn[];
  }

  interface IPackageDoclet {
    kind: "package";
    longname: string;
    files: string[];
    name?: string;
  }

  type TDoclet = | IClassDoclet | IFunctionDoclet | IMemberDoclet | INamespaceDoclet | ITypedefDoclet;
}