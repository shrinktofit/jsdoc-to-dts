import { Emitter, EmitterOtions } from './emitter';
import * as yargs from 'yargs';

yargs
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
};

const emitter = new Emitter(options);
emitter.emit();