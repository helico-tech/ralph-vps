#!/usr/bin/env bun

import { createProgram } from "./cli/index";

const program = await createProgram();
await program.parseAsync(process.argv);
