import { Emitter, EmitterOtions } from './emitter';
import * as yargs from 'yargs';

yargs
    .option('source-root', {
        type: 'string',
        desc: 'source root'
    })
    .option('destination', {
        type: 'string',
        alias: 'd',
        desc: 'output path'
    })
    .option('excludes', {
        type: 'array',
        alias: 'e',
        desc: 'path patterns to exclude',
        array: true
    });

const options: EmitterOtions = {
    inputs: yargs.argv._,
    outputDir: yargs.argv['destination'],
    excludes: yargs.argv['excludes'],
    sourceRoot: yargs.argv['source-root'],
};

const emitter = new Emitter(options);
emitter.emit();