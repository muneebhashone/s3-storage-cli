#!/usr/bin/env bun

import { runCli } from "../src/cli";

const exitCode = await runCli(process.argv.slice(2));
process.exit(exitCode);
