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

interface RegisterCallResponse {
  callId?: string;
  sampleRate: number;
}

const webClient = new RetellWebClient();

const App = () => {
  const [isCalling, setIsCalling] = useState(false);
  const webRTCRef = useRef(null);

  useEffect(() => {
    webClient.on("audio", (audio: Uint8Array) => {
      if (webRTCRef.current) {
        webRTCRef.current.sendAudioData(audio);
      }
    });

    webClient.on("conversationStarted", () =>
      console.log("conversationStarted")
    );
    webClient.on("conversationEnded", ({ code, reason }) => {
      console.log("Closed with code:", code, ", reason:", reason);
      setIsCalling(false);
    });
    webClient.on("error", (error) => {
      console.error("An error occurred:", error);
      setIsCalling(false);
    });
    webClient.on("update", (update) => {
      console.log("update", update);
      if(update.turntaking === "user_turn") {
        webRTCRef.current.interrupt();
      }
    });
  }, []);

  const toggleConversation = async () => {
    if (isCalling) {
      webClient.stopConversation();
    } else {
      webRTCRef.current.start();
      const registerCallResponse = await registerCall(agentId);
      if (registerCallResponse.callId) {
        webClient
          .startConversation({
            callId: registerCallResponse.callId,
            sampleRate: registerCallResponse.sampleRate,
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
