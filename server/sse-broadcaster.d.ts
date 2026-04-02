/**
 * SSE 广播器 - 共享模块，供多个文件使用
 */
import express from 'express';
declare class SSEBroadcaster {
    private clients;
    addClient(res: express.Response): void;
    removeClient(res: express.Response): void;
    broadcast(event: object): void;
}
export declare const sseBroadcaster: SSEBroadcaster;
export {};
