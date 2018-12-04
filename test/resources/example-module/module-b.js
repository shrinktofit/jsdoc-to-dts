

import { A } from './module-a';

export class B {
    constructor() {
        /**
         * @type {A}
         */
        this.a = new A();
    }
}