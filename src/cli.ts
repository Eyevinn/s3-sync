#! /usr/bin/env node

import { Command } from 'commander';
import { sayHello } from '.';

const cli = new Command();
cli
  .description('A simple CLI for TypeScript Node.js projects')
  .action(async (options) => {
    try {
      await sayHello();
    } catch (err) {
      console.log((err as Error).message);
    }
  });

cli.parseAsync(process.argv);
