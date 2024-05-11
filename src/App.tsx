import React, { useEffect, useState, useRef } from "react";
import "./App.css";
import { RetellWebClient } from "retell-client-js-sdk";

const agentId = "a3cfb6d7264592344634753c976bb05c";

interface RegisterCallResponse {
  callId?: string;
  sampleRate: number;
}

interface ImageFrame {
  frameWidth: number;
  frameHeight: number;
  imageData: Uint8Array;
}

const webClient = new RetellWebClient();

const App = () => {
  // ----------------- Simli -----------------
  const [start, setStart] = useState(false); // Start button state
  const [ws, setWs] = useState<WebSocket | null>(null); // WebSocket connection for audio data

  // Minimum chunk size for decoding,
  // Higher chunk size will result in longer delay but smoother playback
  // ( 1 chunk = 0.033 seconds )
  // ( 30 chunks = 0.99 seconds )
  const minimumChunkSize = useRef<number>(15);
  const [minimumChunkSizeState, setMinimumChunkSizeState] = useState<number>(
    minimumChunkSize.current
  );

  const startTime = useRef<any>();
  const executionTime = useRef<any>();
  const [chunkCollectionTime, setChunkCollectionTime] = useState<number>(0);
  const currentChunkSize = useRef<number>(0); // Current chunk size for decoding

  const startTimeFirstByte = useRef<any>(null);
  const timeTillFirstByte = useRef<any>(null);
  const [timeTillFirstByteState, setTimeTillFirstByteState] =
    useState<number>(0);

  // ------------------- AUDIO -------------------
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null); // AudioContest for decoding audio data
  const audioQueue = useRef<Array<AudioBuffer>>([]); // Ref for audio queue
  const [audioQueueLengthState, setAudioQueueLengthState] = useState<number>(0); // State for audio queue length
  const [playing, setPlaying] = useState(false); // State of playing audio
  const accumulatedAudioBuffer = useRef<Array<Uint8Array>>([]); // Buffer for accumulating incoming data until it reaches the minimum size for decoding

  const audioConstant = 0.042; // Audio constant for audio playback to tweak chunking
  const playbackDelay =
    minimumChunkSize.current * (1000 / 30) +
    minimumChunkSize.current * audioConstant; // Playback delay for audio and video in milliseconds

  // ------------------- VIDEO -------------------
  const frameQueue = useRef<Array<Array<ImageFrame>>>([]); // Queue for storing video data
  const [frameQueueLengthState, setFrameQueueLengthState] = useState<number>(0); // State for frame queue length
  const accumulatedFrameBuffer = useRef<Array<ImageFrame>>([]); // Buffer for accumulating incoming video data
  const currentFrameBuffer = useRef<Array<ImageFrame>>([]); // Buffer for accumulating incoming video data
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [videoContext, setVideoContext] =
    useState<CanvasRenderingContext2D | null>(null);
  const currentFrame = useRef(0);
  const fps = 30;
  // const frameInterval = 1000 / fps; // Calculate the time between frames in milliseconds
  const frameInterval = 30; // Time between frames in milliseconds (30 seems to work nice)

  /* Main loop */
  useEffect(() => {
    const intervalId = setInterval(() => {
      if (start && audioQueue.current.length > 0) {
        playFrameQueue();
        playAudioQueue();
      }
    }, playbackDelay);

    return () => clearInterval(intervalId);
  }, [audioContext]);

  /* Create AudioContext at the start */
  useEffect(() => {
    // Return if start is false
    if (start === false) return;

    // Initialize AudioContext
    const newAudioContext = new AudioContext();
    setAudioContext(newAudioContext);

    // Intialize VideoContext
    const videoCanvas = canvasRef.current;
    if (videoCanvas) {
      setVideoContext(videoCanvas?.getContext("2d"));
    }
  }, [start]);

  /* Connect with Lipsync stream */
  useEffect(() => {
    // Return if start is false
    if (start === false) return;

    const ws_lipsync = new WebSocket("ws://api.simli.ai/LipsyncStream");
    ws_lipsync.binaryType = "arraybuffer";
    setWs(ws_lipsync);

    ws_lipsync.onopen = () => {
      console.log("Connected to lipsync server");

      const metadata = {
        video_reference_url:
          "https://storage.googleapis.com/charactervideos/5514e24d-6086-46a3-ace4-6a7264e5cb7c/5514e24d-6086-46a3-ace4-6a7264e5cb7c.mp4",
        face_det_results:
          "https://storage.googleapis.com/charactervideos/5514e24d-6086-46a3-ace4-6a7264e5cb7c/5514e24d-6086-46a3-ace4-6a7264e5cb7c.pkl",
        isSuperResolution: true,
        isJPG: true,
        syncAudio: true,
      };
      ws_lipsync.send(JSON.stringify(metadata));
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
        if (ws) {
          console.error("Closing Lipsync WebSocket");
          ws.close();
        }
      };
    };

    return () => {
      console.error("Closing Lipsync WebSocket");
      ws_lipsync.close();
    };
  }, [audioContext]);

  async function playback() {
    while (audioQueue.current.length > 0) {
      playFrameQueue();
      const playbackDuration = await playAudioQueue();
      await new Promise((resolve) =>
        setTimeout(resolve, minimumChunkSize.current * (1000 / 30))
      );
    }
  }

  /* Process Data Bytes to Audio and Video */
  const processToVideoAudio = async (dataArrayBuffer: ArrayBuffer) => {
    let data = new Uint8Array(dataArrayBuffer);

    // Extracting the endIndex from the message
    const endIndex = new DataView(data.buffer.slice(5, 9)).getUint32(0, true);

    // --------------- VIDEO DATA ----------------

    // Print first 5 bytes of the message as string
    const videoMessage = new TextDecoder().decode(data.slice(0, 5));

    // Extracting frame metadata
    const frameIndex = new DataView(data.buffer.slice(0 + 9, 4 + 9)).getUint32(
      0,
      true
    );
    const frameWidth = new DataView(data.buffer.slice(4 + 9, 8 + 9)).getUint32(
      0,
      true
    );
    const frameHeight = new DataView(
      data.buffer.slice(8 + 9, 12 + 9)
    ).getUint32(0, true);
    const imageData = data.subarray(12 + 9, endIndex + 9); // The rest is image data

    // Push image data to frame queue
    const imageFrame: ImageFrame = { frameWidth, frameHeight, imageData };
    updateFrameQueue(imageFrame);
    setFrameQueueLengthState(frameQueue.current.length);

    // --------------- AUDIO DATA ----------------

    const audioMessage = new TextDecoder().decode(
      data.slice(endIndex + 9, endIndex + 14)
    );

    // Extract Audio data
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
    currentFrameBuffer.current = frameQueue.current.shift();

    const drawFrame = async () => {
      if (currentFrame.current >= currentFrameBuffer.current.length) {
        currentFrame.current = 0;
        return;
      }

      const arrayBuffer =
        currentFrameBuffer.current[currentFrame.current].imageData;
      const width = currentFrameBuffer.current[currentFrame.current].frameWidth;
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
    if (currentChunkSize.current >= minimumChunkSize.current) {
      frameQueue.current.push(accumulatedFrameBuffer.current);
      accumulatedFrameBuffer.current = [];
    } else {
      accumulatedFrameBuffer.current.push(imageFrame);
    }
  };

  /* Decode ArrayBuffer data to Audio and push to audio queue */
  const updateAudioQueue = async (data: ArrayBuffer) => {
    if (currentChunkSize.current >= minimumChunkSize.current) {
      console.log("--------- CHUNK SIZE REACHED", currentChunkSize);

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
      const decodedAudioData = await createAudioBufferFromPCM16(
        concatenatedData
      );

      // 4: Push decoded audio data to the queue
      audioQueue.current.push(decodedAudioData);

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
    const audioBuffer = audioContext!.createBuffer(1, numSamples, 16000);
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
    if (!audioBuffer) return 0;
    const source = audioContext!.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioContext!.destination);

    executionTime.current = performance.now() - startTime.current;
    setChunkCollectionTime(executionTime.current);
    console.log(
      "Chunk collection time:",
      executionTime.current / 1000,
      "seconds"
    );
    startTime.current = null;
    executionTime.current = 0;

    // Start playback
    source.start(0);

    console.log(
      `Playing audio: AudioDuration: ${audioBuffer!.duration.toFixed(2)}`
    );

    // Return back audio duration
    return audioBuffer!.duration;
  }

  const handlePauseAudio = () => {
    setPlaying(false);
  };

  const handleResumeAudio = () => {
    setPlaying(true);
  };

  const handleMinimumChunkSizeChange = (event: any) => {
    setPlaying(false);
    minimumChunkSize.current = parseInt(event.target.value);
    setMinimumChunkSizeState(minimumChunkSize.current);
  };

  // ----------------- Retell -----------------

  // Initialize the SDK
  useEffect(() => {
    // Setup event listeners
    webClient.on("conversationStarted", () => {
      console.log("conversationStarted");
    });

    webClient.on("audio", (audio: Uint8Array) => {
      console.log("There is audio");

      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(audio);
        startTimeFirstByte.current = performance.now(); // Start time for first byte

        // Send zeros to lipsync server for silence
        // const zeroData = new Uint8Array(256);
        // ws.send(zeroData.buffer);
      }
    });

    webClient.on("conversationEnded", ({ code, reason }) => {
      console.log("Closed with code:", code, ", reason:", reason);
      setStart(false); // Update button to "Start" when conversation ends
    });

    webClient.on("error", (error) => {
      console.error("An error occurred:", error);
      setStart(false); // Update button to "Start" in case of error
    });

    webClient.on("update", (update) => {
      // Print live transcript as needed
      console.log("update", update);
    });
  }, [audioContext, ws]);

  const toggleConversation = async () => {
    if (start) {
      webClient.stopConversation();
    } else {
      const registerCallResponse = await registerCall(agentId);
      if (registerCallResponse.callId) {
        webClient
          .startConversation({
            callId: registerCallResponse.callId,
            sampleRate: registerCallResponse.sampleRate,
            enableUpdate: true,
          })
          .catch(console.error);
        setStart(true); // Update button to "Stop" when conversation starts
      }
    }
  };

  async function registerCall(agentId: string): Promise<RegisterCallResponse> {
    try {
      // Replace with your server url
      const response = await fetch(
        "http://localhost:8080/register-call-on-your-server",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            agentId: agentId,
          }),
        }
      );

      if (!response.ok) {
        throw new Error(`Error: ${response.status}`);
      }

      const data: RegisterCallResponse = await response.json();
      return data;
    } catch (err) {
      console.log(err);
      throw new Error(err);
    }
  }

  return (
    <div className="App">
      <header className="App-header">
        <canvas
          ref={canvasRef}
          width="512"
          height="512"
          style={{ border: "1px solid black" }}
        ></canvas>
        <button onClick={toggleConversation} className="StartButton">
          {start ? "Stop" : "Start"}
        </button>
      </header>
    </div>
  );
};

export default App;
