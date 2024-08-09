import React, { useEffect, useState, useRef } from "react";
import "./App.css";
import { RetellWebClient } from "simli-retell-client-js-sdk";
import { SimliClient } from "simli-client";

// Retell agent ID
// You can get your agent ID from the Retell dashboard: https://beta.retellai.com/dashboard
const agentId = "640619f3e4d5bbe7aceaa1181ebcc141";

// Simli face ID
// Get all the available face IDs: https://docs.simli.com/api-reference/endpoint/getPossibleFaceIDs
const faceId = "5514e24d-6086-46a3-ace4-6a7264e5cb7c";

interface RegisterCallResponse {
  callId?: string;
  sampleRate?: number;
}

const retellClient = new RetellWebClient();

const simliClient = new SimliClient();

const App = () => {
  const [isCalling, setIsCalling] = useState(false);
  const videoRef = useRef(null);
  const audioRef = useRef(null);

  useEffect(() => {
    retellClient.on("audio", (audio: Uint8Array) => {
      simliClient.sendAudioData(audio);
    });

    retellClient.on("conversationStarted", () => {
      console.log("conversationStarted")
      simliClient.sendAudioData(new Uint8Array(6000));
    });
    retellClient.on("conversationEnded", ({ code, reason }) => {
      console.log("Closed with code:", code, ", reason:", reason);
      setIsCalling(false);
    });
    retellClient.on("error", (error) => {
      console.error("An error occurred:", error);
      setIsCalling(false);
    });
    retellClient.on("update", (update) => {
      console.log("update", update);
    });
  }, []);

  const toggleConversation = async () => {
    if (isCalling) {
      retellClient.stopConversation();
    } else {

      const simliConfig = {
        apiKey: process.env.REACT_APP_SIMLI_KEY,
        faceID: faceId,
        handleSilence: true,
        videoRef: videoRef,
        audioRef: audioRef,
      };

      simliClient.Initialize(simliConfig);
      await simliClient.start();

      const registerCallResponse = await registerCall(agentId);
      console.log("Register call response", registerCallResponse);
      if (registerCallResponse.callId) {
        retellClient
          .startConversation({
            callId: registerCallResponse.callId,
            sampleRate: 16000,
            enableUpdate: true,
          })
          .catch(console.error);
        setIsCalling(true);
      }
    }
  };

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
      throw err;
    }
  }

  return (
    <div className="App">
      <header className="App-header">
        <div>
          <video ref={videoRef} autoPlay playsInline></video>
          <audio ref={audioRef} autoPlay></audio>
        </div>
        <br />
        <button onClick={toggleConversation}>
          {isCalling ? "Stop" : "Start"}
        </button>
      </header>
    </div>
  );
};

export default App;