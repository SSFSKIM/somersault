#!/usr/bin/env node
import React from "react";
import { render } from "ink";
import { connectDaemon, daemonSocketPath } from "cc-harness";
import { App } from "./App.js";

const args = process.argv.slice(2);
let socket = daemonSocketPath();
for (let i = 0; i < args.length; i++) if (args[i] === "--socket" && args[i + 1] != null) socket = args[++i];

const { waitUntilExit } = render(<App client={connectDaemon(socket)} socketPath={socket} />);
waitUntilExit().then(() => process.exit(0));
