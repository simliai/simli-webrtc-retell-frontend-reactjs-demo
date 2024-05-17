import { EventEmitter } from "eventemitter3";
export interface AudioWsConfig {
    callId: string;
    enableUpdate?: boolean;
    customEndpoint?: string;
}
export declare class AudioWsClient extends EventEmitter {
    private ws;
    constructor(audioWsConfig: AudioWsConfig);
    send(audio: Uint8Array): void;
    close(): void;
}
export declare function convertUint8ToFloat32(array: Uint8Array): Float32Array;
export declare function convertFloat32ToUint8(array: Float32Array): Uint8Array;
