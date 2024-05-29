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

  // Minimum chunk size for decoding,
  // Higher chunk size will result in longer delay but smoother playback
  // ( 1 chunk = 0.033 seconds )
  // ( 30 chunks = 0.99 seconds )
  minimumChunkSize?: number;

  // Face ID for the video
  faceId?: string;
}

const SimliFaceStream = forwardRef(
  ({ start, minimumChunkSize = 8, faceId = "tmp9i8bbq7c" }: props, ref) => {
    useImperativeHandle(ref, () => ({
      sendAudioDataToLipsync,
    }));
    SimliFaceStream.displayName = "SimliFaceStream";

    // const [ws, setWs] = useState<WebSocket | null>(null); // WebSocket connection for audio data
    const ws = useRef<WebSocket | null>(null); // WebSocket connection for audio data

    const startTime = useRef<any>();
    const executionTime = useRef<any>();
    // NOTE: chunkCollectionTime is not in use
    const [chunkCollectionTime, setChunkCollectionTime] = useState<number>(0);
    // NOTE: If I'm understanding this correctly,
    // currentChunkSize is the number of chunks in the "buffer" / "waiting que"
    // evaluate renaming it to "numberOfChunksInQue", "chunksInQue" or similar
    const currentChunkSize = useRef<number>(0); // Current chunk size for decoding

    const startTimeFirstByte = useRef<any>(null);
    const timeTillFirstByte = useRef<any>(null);

    // NOTE: timeTillFirstByteState is not in use
    const [timeTillFirstByteState, setTimeTillFirstByteState] =
      useState<number>(0);

    // ------------------- AUDIO -------------------
    const audioContext = useRef<AudioContext | null>(null); // Ref for audio context
    const audioQueue = useRef<Array<AudioBuffer>>([]); // Ref for audio queue

    // NOTE: audioQueueLengthState is not in use
    const [audioQueueLengthState, setAudioQueueLengthState] =
      useState<number>(0); // State for audio queue length
    const accumulatedAudioBuffer = useRef<Array<Uint8Array>>([]); // Buffer for accumulating incoming data until it reaches the minimum size for decoding

    // NOTE: audioConstant is not in use
    const audioConstant = 0.042; // Audio constant for audio playback to tweak chunking
    const playbackDelay = minimumChunkSize * (1000 / 30); // Playback delay for audio and video in milliseconds

    // NOTE: isQueuePlaying is not in use
    const isQueuePlaying = useRef<boolean>(false); // Flag for checking if the queue is playing
    const callCheckAndPlayFromQueueOnce = useRef<boolean>(true);
    const audioQueueEmpty = useRef<boolean>(false);

    // ------------------- VIDEO -------------------
    const frameQueue = useRef<Array<Array<ImageFrame>>>([]); // Queue for storing video data

    // NOTE: frameQueueLengthState is not in use
    const [frameQueueLengthState, setFrameQueueLengthState] =
      useState<number>(0); // State for frame queue length
    const accumulatedFrameBuffer = useRef<Array<ImageFrame>>([]); // Buffer for accumulating incoming video data
    const currentFrameBuffer = useRef<Array<ImageFrame>>([]); // Buffer for accumulating incoming video data
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [videoContext, setVideoContext] =
      useState<CanvasRenderingContext2D | null>(null);
    const currentFrame = useRef(0);

    // NOTE: fps variable is not used.
    // I'm not sure if it's needed
    // Maybe it should be used to calculate frameInterval?
    const fps = 30;

    // const frameInterval = 1000 / fps; // Calculate the time between frames in milliseconds
    const frameInterval = 30; // Time between frames in milliseconds (30 seems to work nice)

    /* Main loop */
    useEffect(() => {
      const intervalId = setInterval(() => {
        if (audioQueueEmpty.current && !callCheckAndPlayFromQueueOnce.current) {
          playAudioQueue();
        }
      }, playbackDelay + 33);

      return () => clearInterval(intervalId);
    }, [
      audioContext.current,
      // NOTE: These values should be in the dependency array
      // Just because the use effect depends on them.
      // playAudioQueue,
      // playbackDelay
    ]);

    /* Create AudioContext at the start */
    useEffect(() => {
      // Return if start is false
      if (start === false) return;

      // Initialize AudioContext
      const newAudioContext = new AudioContext({ sampleRate: 16000 });
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

    const startAudioToVideoSession = async (
      faceId: string,
      isJPG: Boolean,
      syncAudio: Boolean
    ) => {
      const metadata = {
        faceId: faceId,
        isJPG: isJPG,
        apiKey: process.env.REACT_APP_SIMLI_KEY,
        syncAudio: syncAudio,
      };

      const response = await fetch(
        "https://api.simli.ai/startAudioToVideoSession",
        {
          method: "POST",
          body: JSON.stringify(metadata),
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      return response.json();
    };

    /* Connect with Lipsync stream */
    useEffect(() => {
      // Return if start is false
      if (start === false) return;

      /**
       * NOTE:
       * The functionality within the "then" method could potentially be a part of startAudioToVideoSession,
       * or it should be wrapped inside another function
       *
       *
       *
       */
      startAudioToVideoSession(faceId, true, true).then((data) => {
        const sessionToken = data.session_token;
        const ws_lipsync = new WebSocket("wss://api.simli.ai/LipsyncStream");
        ws_lipsync.binaryType = "arraybuffer";
        ws.current = ws_lipsync;

        ws_lipsync.onopen = () => {
          console.log("Connected to lipsync server");
          ws_lipsync.send(sessionToken);
        };

        ws_lipsync.onmessage = (event) => {
          timeTillFirstByte.current =
            performance.now() - startTimeFirstByte.current;
          setTimeTillFirstByteState(timeTillFirstByte.current);

          if (startTime.current === null) {
            startTime.current = performance.now();
          }

          // console.log("Received data arraybuffer from lipsync server:", event.data);
          processToVideoAudio(event.data);

          currentChunkSize.current += 1; // Increment chunk size by 1

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
      });
    }, [
      audioContext,
      start,
      // NOTE: these should likely be in the dependency array too
      // faceId,
      // processToVideoAudio
    ]);

    /* Process Data Bytes to Audio and Video */
    const processToVideoAudio = async (dataArrayBuffer: ArrayBuffer) => {
      let data = new Uint8Array(dataArrayBuffer);

      // Extracting the endIndex from the message
      const endIndex = new DataView(data.buffer.slice(5, 9)).getUint32(0, true);

      // --------------- VIDEO DATA ----------------

      // Print first 5 bytes of the message as string
      // NOTE: this is not in use, but it's for debugging?
      const videoMessage = new TextDecoder().decode(data.slice(0, 5));

      // Extracting frame metadata
      /**
       * NOTE: the below code has a bunch of "magic numbers", unsure if it's needed to document, but would be helpful to understand what's going on :)
       * Especially this line is a bit confusing:
       * from code: data.buffer.slice(0 + 9, 4 + 9)
       * Why exactly this? What is the difference from the above to the below?
       * Why not "data.buffer.slice(9, 13)"?
       * Also, why do we get the frameIndex from 9, 13
       *
       * Recommended reading: https://stackoverflow.com/questions/47882/what-are-magic-numbers-and-why-do-some-consider-them-bad
       *
       */

      // NOTE: frameIndex is not in use
      const frameIndex = new DataView(
        data.buffer.slice(0 + 9, 4 + 9)
      ).getUint32(0, true);
      const frameWidth = new DataView(
        data.buffer.slice(4 + 9, 8 + 9)
      ).getUint32(0, true);
      const frameHeight = new DataView(
        data.buffer.slice(8 + 9, 12 + 9)
      ).getUint32(0, true);
      const imageData = data.subarray(12 + 9, endIndex + 9); // The rest is image data

      // Push image data to frame queue
      const imageFrame: ImageFrame = { frameWidth, frameHeight, imageData };
      updateFrameQueue(imageFrame);
      setFrameQueueLengthState(frameQueue.current.length);

      // --------------- AUDIO DATA ----------------

      // NOTE: audioMessage is not in use, debugging use?
      const audioMessage = new TextDecoder().decode(
        data.slice(endIndex + 9, endIndex + 14)
      );

      // Extract Audio data
      // NOTE: magic number 18?
      const audioData = data.subarray(endIndex + 18);

      // Push audio data to audio queue
      updateAudioQueue(audioData);
      setAudioQueueLengthState(audioQueue.current.length);

      console.log("Received chunk from Lipsync");

      // --------------- LOGGING ----------------

      // Log Everything
      // console.log(
      //   `${videoMessage}: ${imageData.byteLength}\n` +
      //     `${audioMessage}: ${audioData.byteLength}\n` +
      //     `endIndex: ${endIndex}`
      // );
      // console.warn("");
    };

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
      if (currentChunkSize.current >= minimumChunkSize) {
        frameQueue.current.push(accumulatedFrameBuffer.current);
        accumulatedFrameBuffer.current = [];
      } else {
        accumulatedFrameBuffer.current.push(imageFrame);
      }
    };

    // NOTE: The comments in this section are really helpful! :)
    /* Decode ArrayBuffer data to Audio and push to audio queue */
    const updateAudioQueue = async (data: ArrayBuffer) => {
      if (currentChunkSize.current >= minimumChunkSize) {
        console.log(`|| QUEUE LENGTH: ${audioQueue.current.length} ||`);

        // If the accumulated data reaches the minimum chunk size, decode and push to the queue
        // Calculate the chunk collection time
        executionTime.current = performance.now() - startTime.current;
        setChunkCollectionTime(executionTime.current);
        console.log(
          "Chunk collection time:",
          executionTime.current / 1000,
          "seconds"
        );
        startTime.current = null;
        executionTime.current = 0;

        // 1: Concatenate Uint8Arrays into a single Uint8Array
        const accumulatedAudioBufferTotalByteLength =
          accumulatedAudioBuffer.current.reduce(
            (total, array) => total + array.byteLength,
            0
          );
        const concatenatedData = new Uint8Array(
          accumulatedAudioBufferTotalByteLength
        );
        let offset = 0;
        for (const array of accumulatedAudioBuffer.current) {
          concatenatedData.set(array, offset);
          offset += array.byteLength;
        }

        // 2: Reset accumulated data buffer
        accumulatedAudioBuffer.current = [];

        // 3: Decode concatenated data as PCM16 audio
        console.log("Decoding audio data", concatenatedData);
        const decodedAudioData = await createAudioBufferFromPCM16(
          concatenatedData
        );

        // 4: Push decoded audio data to the queue
        audioQueue.current.push(decodedAudioData);

        // 5: Check and Play
        if (callCheckAndPlayFromQueueOnce.current) {
          console.log("Checking and playing from queue ONCE");
          callCheckAndPlayFromQueueOnce.current = false;
          playAudioQueue();
        }

        currentChunkSize.current = 0; // Reset chunk size
      } else {
        // Else: Accumulate received data
        if (!accumulatedAudioBuffer.current) {
          accumulatedAudioBuffer.current = [new Uint8Array(data)];
        } else {
          accumulatedAudioBuffer.current.push(new Uint8Array(data));
        }
      }
    };

    /* Helper function to decode ArrayBuffer as PCM16 */
    async function createAudioBufferFromPCM16(
      input: Uint8Array
    ): Promise<AudioBuffer> {
      // Ensure the input byte length is even
      if (input.length % 2 !== 0) throw new Error("Input length must be even");

      const numSamples = input.length / 2;
      const audioBuffer = audioContext.current!.createBuffer(
        1,
        numSamples,
        16000
      );
      const channelData = audioBuffer.getChannelData(0);

      for (let i = 0, j = 0; i < input.length; i += 2, j++) {
        // Little-endian byte order
        let int16 = (input[i + 1] << 8) | input[i];
        // Convert from uint16 to int16
        if (int16 >= 0x8000) int16 |= ~0xffff;
        // Normalize to range -1.0 to 1.0
        channelData[j] = int16 / 32768.0;
      }

      return audioBuffer;
    }

    /* Play audio in the queue */
    async function playAudioQueue(): Promise<number> {
      const audioBuffer = audioQueue.current.shift();
      if (!audioBuffer) {
        console.log("AudioBuffer is empty");
        // TODO: Send silent audio data
        // for (let i = 0; i < minimumChunkSize*2; i++) {
        //   ws.current.send(new Uint8Array(256));
        //   console.log("Sending silent audio data");
        // }
        audioQueueEmpty.current = true;
        return 0;
      } else {
        playFrameQueue();
      }
      const source = audioContext.current!.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContext.current!.destination);

      // Start playback
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
