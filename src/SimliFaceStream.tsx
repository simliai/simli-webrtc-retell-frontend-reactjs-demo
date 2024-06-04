import React, {
  useState,
  useEffect,
  useRef,
  forwardRef,
  useImperativeHandle,
} from "react";

interface ImageFrame {
  frameWidth: number;
  frameHeight: number;
  imageData: Uint8Array;
}

interface props {
  // Start the stream
  start: boolean;

  // Session token for the video
  sessionToken: string;

  // Minimum chunk size for decoding,
  // Higher chunk size will result in longer delay but smoother playback
  // ( 1 chunk = 0.033 seconds )
  // ( 30 chunks = 0.99 seconds )
  minimumChunkSize?: number;
}

const SimliFaceStream = forwardRef(
  ({ start, sessionToken, minimumChunkSize = 8 }: props, ref) => {
    useImperativeHandle(ref, () => ({
      sendAudioDataToLipsync,
    }));
    SimliFaceStream.displayName = "SimliFaceStream";

    const ws = useRef<WebSocket | null>(null); // WebSocket connection for audio data

    const startTime = useRef<any>();
    const executionTime = useRef<any>();

    const numberOfChunksInQue = useRef<number>(0); // Number of buffered chunks in queue waiting to be decoded

    const startTimeFirstByte = useRef<any>(null);
    const timeTillFirstByte = useRef<any>(null);

    // ------------------- AUDIO -------------------
    const audioContext = useRef<AudioContext | null>(null); // Ref for audio context
    const audioQueue = useRef<Array<AudioBuffer>>([]); // Ref for audio queue

    const accumulatedAudioBuffer = useRef<Uint8Array>(null); // Buffer for accumulating incoming data until it reaches the minimum size for decoding

    const playbackDelay = minimumChunkSize * (1000 / 30); // Playback delay for audio and video in milliseconds

    const callCheckAndPlayFromQueueOnce = useRef<boolean>(true);
    const audioQueueEmpty = useRef<boolean>(false);

    // ------------------- VIDEO -------------------
    const frameQueue = useRef<Array<Array<ImageFrame>>>([]); // Queue for storing video data

    const accumulatedFrameBuffer = useRef<Array<ImageFrame>>([]); // Buffer for accumulating incoming video data
    const currentFrameBuffer = useRef<Array<ImageFrame>>([]); // Buffer for accumulating incoming video data
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [videoContext, setVideoContext] =
      useState<CanvasRenderingContext2D | null>(null);
    const currentFrame = useRef(0);

    const fps = 30;
    const frameInterval = 30; // Calculate the time between frames in milliseconds

    /* Main loop */
    useEffect(() => {
      const intervalId = setInterval(() => {
        if (audioQueueEmpty.current && !callCheckAndPlayFromQueueOnce.current) {
          playAudioQueue();
        }
      }, playbackDelay + 10); // Add 10ms to the playback delay to give more time for chunk collection

      return () => clearInterval(intervalId);
    }, [
      audioContext.current,
      // NOTE: These values should be in the dependency array
      // Just because the use effect depends on them.
      playAudioQueue,
      playbackDelay,
    ]);

    /* Create AudioContext at the start */
    useEffect(() => {
      // Return if start is false
      if (start === false) return;

      // Initialize AudioContext
      const newAudioContext = new AudioContext({
        sampleRate: 16000,
      });
      audioContext.current = newAudioContext;

      console.log("AudioContext created");

      // Intialize VideoContext
      const videoCanvas = canvasRef.current;
      if (videoCanvas) {
        setVideoContext(videoCanvas?.getContext("2d"));
        console.log("VideoContext created");
      }
    }, [start]);

    const sendAudioDataToLipsync = (audioData: Uint8Array) => {
      if (ws.current && ws.current.readyState === WebSocket.OPEN) {
        ws.current.send(audioData);
        startTimeFirstByte.current = performance.now(); // Start time for first byte
      }
    };

    /* Process Data Bytes to Audio and Video */
    const processToVideoAudio = async (dataArrayBuffer: ArrayBuffer) => {
      let data = new Uint8Array(dataArrayBuffer);

      // --------------- WEBSOCKET SCHEMA ----------------
      // READ MORE: https://github.com/simliai/simli-next-js-demo/blob/main/Websockets.md

      // 5 bytes for VIDEO message
      const start_VIDEO = 0;
      const end_VIDEO = 5;

      // 4 bytes for total number of video bytes
      const start_numberOfVideoBytes = end_VIDEO;
      const end_numberOfVideoBytes = start_numberOfVideoBytes + 4;
      const numberOfVideoBytes = new DataView(
        data.buffer.slice(start_numberOfVideoBytes, end_numberOfVideoBytes)
      ).getUint32(0, true);

      // 4 bytes for frame index
      const start_frameIndex = end_numberOfVideoBytes;
      const end_frameIndex = start_frameIndex + 4;

      // 4 bytes for frame width
      const start_frameWidth = end_frameIndex;
      const end_frameWidth = start_frameWidth + 4;

      // 4 bytes for frame height
      const start_frameHeight = end_frameWidth;
      const end_frameHeight = start_frameHeight + 4;

      // v bytes for video data
      const start_imageData = end_frameHeight;
      const end_imageData = 9 + numberOfVideoBytes; // we add 9 since we have 4+4+4=9 bytes before the image data

      // 5 bytes for AUDIO message
      const start_AUDIO = end_imageData;
      const end_AUDIO = start_AUDIO + 5;

      // 4 bytes for total number of audio bytes
      const start_numberOfAudioBytes = end_AUDIO;
      const end_numberOfAudioBytes = start_numberOfAudioBytes + 4;
      const numberOfAudioBytes = new DataView(
        data.buffer.slice(start_numberOfAudioBytes, end_numberOfAudioBytes)
      ).getUint32(0, true);

      // a bytes for audio data
      const start_audioData = end_numberOfAudioBytes;
      const end_audioData = start_audioData + numberOfAudioBytes;

      // --------------- VIDEO DATA ----------------

      // For debugging: this should return "VIDEO"
      const videoMessage = new TextDecoder().decode(
        data.slice(start_VIDEO, end_VIDEO)
      );

      const frameWidth = new DataView(
        data.buffer.slice(start_frameWidth, end_frameWidth)
      ).getUint32(0, true);

      const frameHeight = new DataView(
        data.buffer.slice(start_frameHeight, end_frameHeight)
      ).getUint32(0, true);

      const imageData = data.subarray(start_imageData, end_imageData); // The rest is image data

      // Push image data to frame queue
      const imageFrame: ImageFrame = { frameWidth, frameHeight, imageData };
      updateFrameQueue(imageFrame);

      // --------------- AUDIO DATA ----------------

      // For debugging: this should return "AUDIO"
      const audioMessage = new TextDecoder().decode(
        data.slice(start_AUDIO, end_AUDIO)
      );

      // Extract Audio data
      const audioData = data.subarray(start_audioData, end_audioData);

      // Push audio data to audio queue
      updateAudioQueue(audioData);

      // --------------- LOGGING ----------------

      // console.log(
      //   "VIDEO: ", start_VIDEO, end_VIDEO, "\n",
      //   "numberOfVideoBytes: ", start_numberOfVideoBytes, end_numberOfVideoBytes, "=", numberOfVideoBytes, "\n",
      //   "frameIndex: ", start_frameIndex, end_frameIndex, "\n",
      //   "frameWidth: ", start_frameWidth, end_frameWidth, "\n",
      //   "frameHeight: ", start_frameHeight, end_frameHeight, "\n",
      //   "imageData: ", start_imageData, end_imageData, "\n",
      //   "AUDIO: ", start_AUDIO, end_AUDIO, "\n",
      //   "numberOfAudioBytes: ", start_numberOfAudioBytes, end_numberOfAudioBytes, "=", numberOfAudioBytes, "\n",
      //   "audioData: ", start_audioData, end_audioData
      // );

      // console.log(
      //   `${videoMessage}: ${imageData.byteLength}\n` +
      //     `${audioMessage}: ${audioData.byteLength}\n`
      // );

      // console.warn("");
    };

    /* Connect with Lipsync stream */
    useEffect(() => {
      // Return if start is false
      if (start === false) return;

      const ws_lipsync = new WebSocket("wss://api.simli.ai/LipsyncStream");
      ws_lipsync.binaryType = "arraybuffer";
      ws.current = ws_lipsync;

      ws_lipsync.onopen = () => {
        console.log("Connected to lipsync server");
        ws_lipsync.send(sessionToken);
      };

      ws_lipsync.onmessage = (event) => {
        if (startTime.current === null) {
          startTime.current = performance.now();
        }

        // console.log("Received data arraybuffer from lipsync server:", event.data);
        console.log("Received chunk from Lipsync");
        processToVideoAudio(event.data);

        numberOfChunksInQue.current += 1; // Increment chunk size by 1

        return () => {
          if (ws.current) {
            console.error("Closing Lipsync WebSocket");
            ws.current.close();
          }
        };
      };

      return () => {
        console.error("Closing Lipsync WebSocket");
        ws_lipsync.close();
      };
    }, [
      audioContext,
      start,
      // NOTE: these should likely be in the dependency array too
      sessionToken,
      processToVideoAudio,
    ]);

    /* Play video frames queue */
    const playFrameQueue = async () => {
      // Update current frame buffer if there is a new frame
      const frame: ImageFrame[] | undefined = frameQueue.current.shift();
      if (frame !== undefined) {
        currentFrameBuffer.current = frame;
      }

      const drawFrame = async () => {
        if (currentFrame.current >= currentFrameBuffer.current.length) {
          currentFrame.current = 0;
          return;
        }

        const arrayBuffer =
          currentFrameBuffer.current[currentFrame.current].imageData;
        const width =
          currentFrameBuffer.current[currentFrame.current].frameWidth;
        const height =
          currentFrameBuffer.current[currentFrame.current].frameHeight;

        const blob = new Blob([arrayBuffer]); // Convert ArrayBuffer to Blob
        const url = URL.createObjectURL(blob);

        const image = new Image();
        image.onload = () => {
          videoContext?.clearRect(0, 0, width, height);
          videoContext?.drawImage(image, 0, 0, width, height);
          URL.revokeObjectURL(url); // Clean up memory after drawing the image
        };
        image.src = url;

        currentFrame.current++;
        setTimeout(drawFrame, frameInterval); // Set the next frame draw
      };

      await drawFrame();
    };

    /* Update video queue */
    const updateFrameQueue = async (imageFrame: ImageFrame) => {
      if (numberOfChunksInQue.current >= minimumChunkSize) {
        frameQueue.current.push(accumulatedFrameBuffer.current);
        accumulatedFrameBuffer.current = [];
      } else {
        accumulatedFrameBuffer.current.push(imageFrame);
      }
    };

    /* Decode ArrayBuffer data to Audio and push to audio queue */
    const updateAudioQueue = async (data: Uint8Array) => {
      if (numberOfChunksInQue.current >= minimumChunkSize) {
        console.log("1) Decoding audio at time: ", performance.now());
        console.log(`|| QUEUE LENGTH: ${audioQueue.current.length} ||`);

        // If the accumulated data reaches the minimum chunk size, decode and push to the queue
        // Calculate the chunk collection time
        executionTime.current = performance.now() - startTime.current;
        console.log(
          "Chunk collection time:",
          executionTime.current / 1000,
          "seconds"
        );
        startTime.current = null;
        executionTime.current = 0;

        // 1: Decode concatenated data as PCM16 audio
        console.log("Decoding audio data", accumulatedAudioBuffer.current);
        const decodedAudioData = await createAudioBufferFromPCM16(
          accumulatedAudioBuffer.current
        );

        // 2: Reset accumulated data buffer
        accumulatedAudioBuffer.current = null;

        // 3: Push decoded audio data to the queue
        audioQueue.current.push(decodedAudioData);

        // 4: Check and Play only once at start
        if (callCheckAndPlayFromQueueOnce.current) {
          console.log("Checking and playing from queue ONCE");
          callCheckAndPlayFromQueueOnce.current = false;
          playAudioQueue();
        }

        numberOfChunksInQue.current = 0; // Reset chunk size
      } else {
        if (!accumulatedAudioBuffer.current) {
          // If there is no accumulated data, set the data as the accumulated data
          accumulatedAudioBuffer.current = data;
        } else {
          // Concatenate Uint8Arrays into a single Uint8Array
          const combinedUint8Array = new Uint8Array(
            accumulatedAudioBuffer.current.length + data.length
          );
          combinedUint8Array.set(accumulatedAudioBuffer.current, 0);
          combinedUint8Array.set(data, accumulatedAudioBuffer.current.length);
          accumulatedAudioBuffer.current = combinedUint8Array;
        }
      }
    };

    /* Helper function to decode ArrayBuffer as PCM16 */
    // async function createAudioBufferFromPCM16(
    //   input: Uint8Array
    // ): Promise<AudioBuffer> {
    //   // Ensure the input byte length is even
    //   if (input.length % 2 !== 0) throw new Error("Input length must be even");

    //   const numSamples = input.length / 2;
    //   const audioBuffer = audioContext.current!.createBuffer(
    //     1,
    //     numSamples,
    //     16000
    //   );
    //   const channelData = audioBuffer.getChannelData(0);

    //   for (let i = 0, j = 0; i < input.length; i += 2, j++) {
    //     // Little-endian byte order
    //     let int16 = (input[i + 1] << 8) | input[i];
    //     // Convert from uint16 to int16
    //     if (int16 >= 0x8000) int16 |= ~0xffff;
    //     // Normalize to range -1.0 to 1.0
    //     channelData[j] = int16 / 32768.0;
    //   }

    //   return audioBuffer;
    // }

    /* Helper function to decode ArrayBuffer as PCM16 */
    async function createAudioBufferFromPCM16(input: Uint8Array): Promise<AudioBuffer> {
      // Ensure the input byte length is even
      if (input.length % 2 !== 0) throw new Error("Input length must be even");
    
      const numSamples = input.length / 2;
      const audioBuffer = audioContext.current!.createBuffer(1, numSamples, 16000);
      const channelData = audioBuffer.getChannelData(0);
    
      // Convert Uint8Array to Int16Array
      const int16Array = new Int16Array(numSamples);
      for (let i = 0, j = 0; i < input.length; i += 2, j++) {
        int16Array[j] = (input[i + 1] << 8) | input[i];
      }
    
      // Normalize Int16Array to Float32Array
      const float32Array = new Float32Array(numSamples);
      for (let i = 0; i < numSamples; i++) {
        float32Array[i] = int16Array[i] / 32768.0;
      }
    
      // Copy Float32Array to channelData
      channelData.set(float32Array);
    
      return audioBuffer;
    }

    const sendSilence = () => {
      const silence = new Uint8Array(1068 * minimumChunkSize);
      ws.current?.send(silence);
      console.log("Sending silence!");
    };

    /* Play audio in the queue */
    async function playAudioQueue(): Promise<number> {
      const audioBuffer = audioQueue.current.shift();
      if (!audioBuffer) {
        console.log("AudioBuffer is empty");
        sendSilence();
        audioQueueEmpty.current = true;
        return 0;
      } else {
        playFrameQueue();
      }
      const source = audioContext.current!.createBufferSource();
      source.buffer = audioBuffer;
      // source.connect(audioContext.current!.destination);

      // Create a gain node to control volume
      const gainNode = audioContext.current!.createGain();
      
      // Amplify the audio volume
      gainNode.gain.value = 2.0;
      source.connect(gainNode);
      gainNode.connect(audioContext.current!.destination);

      // Calculate the time at which the last x ms of the audio starts
      const lastmsStartTime = audioBuffer.duration - 0.020;

      // Decrement the audio at the last x ms of audio
      gainNode.gain.setTargetAtTime(0.5, audioContext.current!.currentTime + lastmsStartTime, 0.01);

      // Start playback
      console.log("2) Playing audio at time: ", performance.now());
      source.start(0);

      console.log(
        `Playing audio: AudioDuration: ${audioBuffer!.duration.toFixed(2)}`
      );

      // Handle the audio end event
      source.onended = () => {
        console.log("Audio ended");
        audioQueueEmpty.current = false;
        playAudioQueue();
      };

      // Return back audio duration
      return audioBuffer!.duration;
    }

    return <canvas ref={canvasRef} width="512" height="512"></canvas>;
  }
);

export default SimliFaceStream;
