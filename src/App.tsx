import React, { useEffect, useRef, useState } from "react";
import "./App.css";
import { RetellWebClient } from "./simli-retell-client-js-sdk";

const agentId = "a3cfb6d7264592344634753c976bb05c";

interface RegisterCallResponse {
  callId?: string;
  sampleRate: number;
}

const webClient = new RetellWebClient();

const App = () => {
  const [isCalling, setIsCalling] = useState(false);
  const [webSocket, setWebSocket] = useState<WebSocket | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameQueue = useRef([]);
  const audioQueue = useRef<Float32Array[]>([]);
  const audioContext = useRef(new AudioContext());
  const requestRef = useRef();
  const lastFrameTimeRef = useRef(performance.now());
  const audioStarted = useRef(false);
  const firstFrameReceived = useRef(false);

  const [updateMessage, setUpdateMessage] = useState("");

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
          const ctx = canvas.getContext("2d");
          canvas.width = frameWidth;
          canvas.height = frameHeight;
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          URL.revokeObjectURL(url);

          // Check if audio has started or not
          // console.log("audioQueue.current.length", audioQueue.current.length);
          // console.log("frameQueue.current.length", frameQueue.current.length);
          // console.log("audioStarted.current", audioStarted.current);
          if (!audioStarted.current && audioQueue.current.length > 0) {
            playAudioFromBuffer();
            audioStarted.current = true; // Set the flag to true after starting the audio
          }
        };
        img.src = url;
        lastFrameTimeRef.current = now;
      }
    }
    requestRef.current = requestAnimationFrame(processFrameQueue);
  };

  // Convert Audio bytes
  function uint8ToFloat32(uint8Array: Uint8Array): Float32Array {
    const float32Array = new Float32Array(uint8Array.length / 2); // Assuming 16-bit PCM
    for (let i = 0; i < uint8Array.length; i += 2) {
      const int16Value = uint8Array[i] | (uint8Array[i + 1] << 8); // Combine two bytes into a 16-bit integer
      const floatValue = int16Value / 32768.0; // Convert to float32
      float32Array[i / 2] = floatValue;
    }
    return float32Array;
  }

  // Play Audio from Buffer
  const playAudioFromBuffer = async () => {
    // Wait until the first frame has been received
    while (!firstFrameReceived.current) {
      await new Promise((resolve) => setTimeout(resolve, 1)); // Wait for 100 ms before checking again
    }

    // Begin or continue audio playback
    console.log("Audio Buffer Started");
    while (audioQueue.current.length > 0) {
      const segment = audioQueue.current.shift(); // Take the first available segment
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

  useEffect(() => {
    webClient.on("conversationStarted", () => {
      console.log("conversationStarted");
      const ws = new WebSocket("ws://34.91.9.107:8892/LipsyncStream");
      ws.binaryType = "arraybuffer";

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

      ws.onmessage = (event) => {
        console.log("Received message:", event.data);
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
          console.log("Image data length:", imageData.byteLength);

          // Extract Audio data
          const audioData = data.subarray(18 + endIndex);
          console.log("Audio data length:", audioData.byteLength);

          // Convert the audio data to Float32Array and play it
          audioQueue.current.push(uint8ToFloat32(audioData));
          console.log("AudioQueue:", audioQueue);

          // Pushing the frame data into a queue
          frameQueue.current.push({ frameWidth, frameHeight, imageData });

          console.warn("");
        } catch (e) {
          console.error(e);
        }
      };

      ws.onerror = (error) => {
        console.error("WebSocket error:", error);
      };

      ws.onclose = () => {
        console.log("WebSocket connection closed.");
        setWebSocket(null);
      };
    });

    webClient.on("audio", (audio: Uint8Array) => {
      console.log("Received audio data type:", audio.constructor.name); // Logs the type of the audio data

      // if values of audio are not silence then log that
      // if (audio.some((value) => value !== 128)) {
      //   console.log("audio", audio);
      // }
      // const audioData = convertUint8ToFloat32(audio);
      // audioQueue.current.push(audioData);
      // if (!audioStarted.current && audioQueue.current.length > 0) {
      //     playAudioFromBuffer();
      //     audioStarted.current = true;
      // }

      if (webSocket && webSocket.readyState === WebSocket.OPEN) {
        webSocket.send(audio);
        // const audioData = convertUint8ToFloat32(audio);
        // audioQueue.current.push(audioData);
      } else {
        // console.log("WebSocket not ready or closed.");
      }
    });

    webClient.on("conversationEnded", ({ code, reason }) => {
      console.log("Closed with code:", code, ", reason:", reason);
      setIsCalling(false);
      webSocket?.close();
    });

    webClient.on("error", (error) => {
      console.error("An error occurred:", error);
      setIsCalling(false);
    });

    webClient.on("update", (update) => {
      setUpdateMessage(
        update.transcript[update.transcript.length - 1].role +
          ": " +
          update.transcript[update.transcript.length - 1].content
      );
      // console.log("update:", update);
    });

    requestRef.current = requestAnimationFrame(processFrameQueue);

    return () => {
      if (webSocket) {
        webSocket.close();
      }
      cancelAnimationFrame(requestRef.current);
    };
  }, [webSocket]);

  // Start Conversation
  const toggleConversation = async () => {
    if (isCalling) {
      webClient.stopConversation();
      setIsCalling(false);
      webSocket?.close();
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

  // Start a retell call
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

  // Play Audio Buffer
  const handlePlayButtonClick = () => {
    if (audioContext.current.state !== "running") {
      audioContext.current
        .resume()
        .then(() => {
          console.log("AudioContext resumed successfully");
          playAudioFromBuffer(); // Call the function to play audio after resuming context
        })
        .catch((error) => {
          console.error("Error resuming AudioContext:", error);
        });
    } else {
      playAudioFromBuffer();
      audioStarted.current = true;
      // If already running, play audio directly
    }
  };

  return (
    <div className="App">
      <header className="App-header">
        <button onClick={toggleConversation}>
          {isCalling ? "Stop" : "Start"}
        </button>
        <button onClick={handlePlayButtonClick}>Play Audio</button>
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
