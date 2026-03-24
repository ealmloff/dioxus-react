/* tslint:disable */
/* eslint-disable */

export class NativeBridge {
    free(): void;
    [Symbol.dispose](): void;
    fibonacci(n: number): number;
    getEnv(key: string): string | undefined;
    getSystemInfo(): string;
    constructor();
    readDir(path: string): string;
    readFile(path: string): string;
    writeFile(path: string, content: string): string;
}
