import * as fs from 'fs';
import * as path from 'path';
import Emitter from './emitter';
import { TDoclet, JsdocOptions } from 'jsdoc-api';

export async function doPublish(docs: TDoclet[], opts: JsdocOptions) {
    // create an emitter to parse the docs
    const emitter = new Emitter(docs, opts);

    // emit the output
    if (opts.destination === 'console') {
        console.log(emitter.emit());
    } else {
        try {
            fs.mkdirSync(opts.destination);
        } catch (error) {
            if (error.code !== 'EEXIST') {
                throw error;
            }
        }
        const out = path.join(opts.destination, 'cocos-creator-3d.d.ts');
        fs.writeFileSync(out, emitter.emit());
    }
}