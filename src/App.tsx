import React, { useEffect, useRef, useState } from "react";
import "./App.css";
import { RetellWebClient } from "./simli-retell-client-js-sdk/dist";

const agentId = "a3cfb6d7264592344634753c976bb05c";

interface RegisterCallResponse {
  callId?: string;
  sampleRate: number;
}

const webClient = new RetellWebClient();

const App = () => {
  const [isCalling, setIsCalling] = useState(false);
  const [webSocket, setWebSocket] = useState<WebSocket | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameQueue = useRef<any>([]);
  const requestRef = useRef<number>();

  const audioQueue = useRef<Float32Array[]>([]);
  const audioContext = useRef(new AudioContext());
  
  const lastFrameTimeRef = useRef(performance.now());
  const audioStarted = useRef(false);
  const firstFrameReceived = useRef(false);
  const audioOriginal = useRef<Uint8Array[]>([]);
  const audioStreamed = useRef<Uint8Array[]>([]);

  const [updateMessage, setUpdateMessage] = useState("");

  /*
  Render frames from the frame queue
  */
  const processFrameQueue = () => {
    const now = performance.now();
    const timeSinceLastFrame = now - lastFrameTimeRef.current;
    const msPerFrame = 1000 / 30; // Approximately 33.33 milliseconds per frame

    if (timeSinceLastFrame >= msPerFrame) {
      if (frameQueue.current.length > 0) {
        firstFrameReceived.current = true;
        const { frameWidth, frameHeight, imageData } =
          frameQueue.current.shift();
        const blob = new Blob([imageData], { type: "image/jpeg" });
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
          const canvas = canvasRef.current;
          if (canvas) {
            const ctx = canvas.getContext("2d");
            canvas.width = frameWidth;
            canvas.height = frameHeight;
            ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
          }
          URL.revokeObjectURL(url);
        };
        img.src = url;
        lastFrameTimeRef.current = now;
      }
    }
    requestRef.current = requestAnimationFrame(processFrameQueue);
  };

  /*
  Convert Uint8Array to Float32Array
  */
  const convertUint8ToFloat32 = (array: Uint8Array): Float32Array => {
    const targetArray = new Float32Array(array.byteLength / 2);
    const sourceDataView = new DataView(array.buffer);

    for (let i = 0; i < targetArray.length; i++) {
      targetArray[i] = sourceDataView.getInt16(i * 2, true) / 32768; // 2^15 = 32768
    }
    return targetArray;
  };

  /*
  Play audio from the audio queue
  */
  const playAudioFromBuffer = async () => {
    // Wait until the first frame has been received
    // while (!firstFrameReceived.current) {
    //   await new Promise((resolve) => setTimeout(resolve, 1)); // Wait for 100 ms before checking again
    // }

    // Begin or continue audio playback
    console.log("Playing Audio From Buffer");
    while (audioQueue.current.length > 0) {
      const segment = audioQueue.current.shift(); // Take the first available segment
      if (segment === undefined) {
        continue;
      }
      const audioBuffer = audioContext.current.createBuffer(
        1,
        segment.length,
        16000
      );
      audioBuffer.getChannelData(0).set(segment);

      const source = audioContext.current.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContext.current.destination);
      source.start();

      // Optional: Handle the end of playback to trigger additional actions
      source.onended = () => {
        console.log("Audio Segment Finished");
      };

      // Wait until this segment finishes before starting the next
      await new Promise((resolve) => (source.onended = resolve));
    }
  };

  /*
  Initialize the web client and set up event listeners
  */
  useEffect(() => {
    // Initialize Retell web client
    webClient.on("conversationStarted", () => {
      console.log("conversationStarted");
      setIsCalling(true);
      const ws = initializeWebSocket();
      setWebSocket(ws);
      console.log("WebSocket");
    });

    // Retell audio data ready
    webClient.on("audio", (audio: Uint8Array) => {
      console.log("Received audio data type:", audio.constructor.name); // Logs the type of the audio data

      // if values of audio are not silence then log that
      // if (audio.some((value) => value !== 128)) {
      //   console.log("audio", audio);
      // }

      const audioData = convertUint8ToFloat32(audio);
      audioQueue.current.push(audioData);

      playAudioFromBuffer();

      if (webSocket && webSocket.readyState === WebSocket.OPEN) {
        webSocket.send(audio);
      }
    });

    // Retell conversation ended
    webClient.on("conversationEnded", ({ code, reason }) => {
      console.log("Closed with code:", code, ", reason:", reason);
      setIsCalling(false);
      webSocket?.close();
    });

    // Retell error
    webClient.on("error", (error) => {
      console.error("An error occurred:", error);
      setIsCalling(false);
    });

    // Retell transcript update
    webClient.on("update", (update) => {
      setUpdateMessage(
        update.transcript[update.transcript.length - 1].role +
          ": " +
          update.transcript[update.transcript.length - 1].content
      );
    });

    // Animation update
    requestRef.current = requestAnimationFrame(processFrameQueue);
  }, [webClient, webSocket]);

  /*
  Initialize the WebSocket connection
  */
  function initializeWebSocket() {
    const ws = new WebSocket("ws://34.91.9.107:8892/LipsyncStream");
    ws.binaryType = "arraybuffer";

    // WebSocket connection established
    ws.onopen = () => {
      console.log("WebSocket connection established.");
      const metadata = {
        video_reference_url:
          "https://storage.googleapis.com/charactervideos/11c30c18-86c3-424e-bb29-9c6d1fd6003b/11c30c18-86c3-424e-bb29-9c6d1fd6003b.mp4",
        face_det_results:
          "https://storage.googleapis.com/charactervideos/11c30c18-86c3-424e-bb29-9c6d1fd6003b/11c30c18-86c3-424e-bb29-9c6d1fd6003b.pkl",
        isSuperResolution: true,
        isJPG: true,
      };
      ws.send(JSON.stringify(metadata));
      setWebSocket(ws);
    };

    // websocket message event
    ws.onmessage = (event) => {
      console.log("WebSocket Received message:", event.data);
      try {
        const data = new Uint8Array(event.data);

        // Extracting the endIndex from the message
        const endIndex = new DataView(data.buffer.slice(5, 9)).getUint32(
          0,
          true
        );
        console.log("endIndex", endIndex);

        // Extracting the video data
        const video = data.buffer.slice(9, endIndex);

        // Extracting frame metadata
        const frameIndex = new DataView(
          data.buffer.slice(0 + 9, 4 + 9)
        ).getUint32(0, true);
        const frameWidth = new DataView(
          data.buffer.slice(4 + 9, 8 + 9)
        ).getUint32(0, true);
        const frameHeight = new DataView(
          data.buffer.slice(8 + 9, 12 + 9)
        ).getUint32(0, true);

        // Extracting image data
        const imageData = data.subarray(12 + 9, endIndex + 9);
        console.log("WebSocket Image data length:", imageData.byteLength);

        // Extract Audio data
        const audioData = data.subarray(18 + endIndex);
        audioStreamed.current.push(audioData);
        console.log("WebSocket Audio data length:", audioData.byteLength);

        // Convert the audio data to Float32Array and play it
        // audioQueue.current.push(convertUint8ToFloat32(audioData));
        // playAudioFromBufferNow(convertUint8ToFloat32(audioData));

        // Pushing the frame data into a queue
        frameQueue.current.push({ frameWidth, frameHeight, imageData });

        console.warn("");
      } catch (e) {
        console.error(e);
      }
    };

    // Error handling
    ws.onerror = (error) => {
      console.error("WebSocket error:", error);
    };

    // Close websocket connection
    ws.onclose = () => {
      console.log("WebSocket connection closed.");
      setWebSocket(null);
    };

    return ws;
  }

  /*
  Button to toggle conversation start or stop and refreh the page
  */
  const toggleConversation = async () => {
    if (isCalling) {
      webClient.stopConversation();
      setIsCalling(false);
      webSocket?.close();
      window.location.reload();
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
      }
    }
  };

  /*
  Start a retell call
  */
  async function registerCall(agentId: string): Promise<RegisterCallResponse> {
    try {
      const response = await fetch(
        "http://localhost:8080/register-call-on-your-server",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ agentId }),
        }
      );

      if (!response.ok) {
        throw new Error(`Error: ${response.status}`);
      }

      return await response.json();
    } catch (err) {
      console.error(err);
      throw new Error(err.toString());
    }
  }

  return (
    <div className="App">
      <header className="App-header">
        <button onClick={toggleConversation}>
          {isCalling ? "Stop" : "Start"}
        </button>
        <canvas
          ref={canvasRef}
          width="512"
          height="512"
          style={{ border: "1px solid black" }}
        ></canvas>
        <b>{}</b>
        <p>{updateMessage}</p>
      </header>
    </div>
  );
};

export default App;
