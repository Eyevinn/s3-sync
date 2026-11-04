#! /usr/bin/env node

import { buildCli } from './program';

buildCli().parseAsync(process.argv);
