import { JsdocOptions, TDoclet } from "jsdoc-api";

export default class Emitter {
    constructor(docs?: TDoclet[], public config?: JsdocOptions, public eol: string = '\n') {
    }

    emit() {
        
    }
}