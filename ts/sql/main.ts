// Copyright 2021 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import { join } from 'path';
import { Worker } from 'worker_threads';

export type InitializeOptions = {
  readonly configDir: string;
  readonly key: string;
};

export type WorkerRequest =
  | {
      readonly type: 'init';
      readonly options: InitializeOptions;
    }
  | {
      readonly type: 'close';
    }
  | {
      readonly type: 'sqlCall';
      readonly method: string;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      readonly args: ReadonlyArray<any>;
    };

export type WrappedWorkerRequest = {
  readonly seq: number;
  readonly request: WorkerRequest;
};

export type WrappedWorkerResponse = {
  readonly seq: number;
  readonly error: string | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly response: any;
};

type PromisePair<T> = {
  resolve: (response: T) => void;
  reject: (error: Error) => void;
};

export class MainSQL {
  private readonly worker: Worker;

  private readonly onExit: Promise<void>;

  private seq = 0;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private onResponse = new Map<number, PromisePair<any>>();

  constructor() {
    const appDir = join(__dirname, '..', '..').replace(
      /app\.asar$/,
      'app.asar.unpacked'
    );

    this.worker = new Worker(join(appDir, 'ts', 'sql', 'mainWorker.js'));

    this.worker.on('message', (wrappedResponse: WrappedWorkerResponse) => {
      const { seq, error, response } = wrappedResponse;

      const pair = this.onResponse.get(seq);
      this.onResponse.delete(seq);
      if (!pair) {
        throw new Error(`Unexpected worker response with seq: ${seq}`);
      }

      if (error) {
        pair.reject(new Error(error));
      } else {
        pair.resolve(response);
      }
    });

    this.onExit = new Promise<void>(resolve => {
      this.worker.once('exit', resolve);
    });
  }

  public async initialize(options: InitializeOptions): Promise<void> {
    return this.send({ type: 'init', options });
  }

  public async close(): Promise<void> {
    await this.send({ type: 'close' });
    await this.onExit;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public async sqlCall(method: string, args: ReadonlyArray<any>): Promise<any> {
    return this.send({ type: 'sqlCall', method, args });
  }

  private async send<Response>(request: WorkerRequest): Promise<Response> {
    const { seq } = this;
    this.seq += 1;

    const result = new Promise<Response>((resolve, reject) => {
      this.onResponse.set(seq, { resolve, reject });
    });

    const wrappedRequest: WrappedWorkerRequest = {
      seq,
      request,
    };
    this.worker.postMessage(wrappedRequest);

    return result;
  }
}
