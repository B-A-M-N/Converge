/// <reference types="vitest/globals" />
/// <reference types="node" />

import { ChildProcess } from 'child_process';

declare module 'child_process' {
  interface ChildProcess {
    captureMetadata?: any;
    timeoutMetadata?: any;
  }
}
