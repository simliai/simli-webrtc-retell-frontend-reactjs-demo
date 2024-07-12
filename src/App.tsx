import React, { useEffect, useState, useRef } from "react";
import "./App.css";
import { RetellWebClient } from "simli-retell-client-js-sdk";
import WebRTC from "./WebRTC/WebRTC";

// Retell agent ID
// You can get your agent ID from the Retell dashboard: https://beta.retellai.com/dashboard
const agentId = "640619f3e4d5bbe7aceaa1181ebcc141";

// Simli face ID
// Get all the available face IDs: https://docs.simli.com/api-reference/endpoint/getPossibleFaceIDs
const faceId = "5514e24d-6086-46a3-ace4-6a7264e5cb7c";

const retellWebClient = new RetellWebClient();

interface RegisterCallResponse {
  access_token: string;
}

const App = () => {
  const [isCalling, setIsCalling] = useState(false);
  const webRTCRef = useRef(null);

  useEffect(() => {
    retellWebClient.on("call_started", () => {
      console.log("call started");
    });

    retellWebClient.on("call_ended", () => {
      console.log("call ended");
      setIsCalling(false);
    });

    // When agent starts talking for the utterance
    // useful for animation
    retellWebClient.on("agent_start_talking", () => {
      console.log("agent_start_talking");
    });

    // When agent is done talking for the utterance
    // useful for animation
    retellWebClient.on("agent_stop_talking", () => {
      console.log("agent_stop_talking");
    });

    // Real time pcm audio bytes being played back, in format of Float32Array
    // only available when emitRawAudioSamples is true
    retellWebClient.on("audio", (audio) => {
      // console.log(audio);
      if (webRTCRef.current) {
        const audioUint8Array = convertFloat32ToUnsigned8(audio);
        console.log(audioUint8Array);
        webRTCRef.current.sendAudioData(audioUint8Array);
      }
    });

    // Update message such as transcript
    retellWebClient.on("update", (update) => {
      // console.log(update);
      // if(update.turntaking === "user_turn") {
      //   webRTCRef.current.interrupt();
      // }
    });

    retellWebClient.on("metadata", (metadata) => {
      // console.log(metadata);
    });

    retellWebClient.on("error", (error) => {
      console.error("An error occurred:", error);
      // Stop the call
      retellWebClient.stopCall();
    });

  }, []);

  const convertFloat32ToUnsigned8 = (array: Float32Array): Uint8Array => {
    const buffer = new ArrayBuffer(array.length * 2);
    const view = new DataView(buffer);
  
    for (let i = 0; i < array.length; i++) {
      const value = array[i] * 32768;
      view.setInt16(i * 2, value, true); // true for little-endian
    }
  
    return new Uint8Array(buffer);
  }

  const toggleConversation = async () => {
    if (isCalling) {
      retellWebClient.stopCall();
    } else {
      webRTCRef.current?.start();
      const registerCallResponse = await registerCall(agentId);
      if (registerCallResponse.access_token) {
        retellWebClient
          .startCall({
            accessToken: registerCallResponse.access_token,
            sampleRate: 16000,
            emitRawAudioSamples: true,
          })
          .catch(console.error);
        setIsCalling(true); // Update button to "Stop" when conversation starts
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
        },
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
        <WebRTC
          ref={webRTCRef}
          faceID={faceId}
        />
        <br />
        <button onClick={toggleConversation}>
          {isCalling ? "Stop" : "Start"}
        </button>
      </header>
    </div>
  );
};

export default App;
