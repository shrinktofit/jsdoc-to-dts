import { Emitter } from './emitter';
import * as yargs from 'yargs';
import { writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import mkdirp = require('mkdirp');

yargs.alias('d', 'destination').describe('d', 'output path');

const inputs = yargs.argv._;
const emitter = new Emitter(inputs);

const outputDir = yargs.argv['destination'];
emitter.emit(outputDir);