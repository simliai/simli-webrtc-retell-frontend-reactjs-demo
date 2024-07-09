# Simli WebRTC + Retell Frontend Demo (React/Node.js)


https://github.com/simliai/simli-retell-frontend-reactjs-demo/assets/22096869/41916cad-7b8c-42ef-b19c-d594c9d9fdc2

```mermaid
sequenceDiagram
    participant Client as WebRTCComponent
    participant Server as Remote Server
    participant MediaDevices as User's Media Devices

    Client->>Client: start()
    Client->>Client: createPeerConnection()
    Client->>MediaDevices: getUserMedia()
    MediaDevices-->>Client: Return audio/video stream
    Client->>Client: Add tracks to RTCPeerConnection
    Client->>Client: createDataChannel()
    Client->>Client: negotiate()
    Client->>Client: createOffer()
    Client->>Client: setLocalDescription()
    Client->>Server: Send offer to /offer endpoint
    Server-->>Client: Send answer
    Client->>Client: setRemoteDescription()
    Client->>Server: ICE candidates exchange
    Note over Client,Server: WebRTC Connection Established
    Client->>Server: Send "startAudioToVideoSession" request
    Server-->>Client: Return session token
    Client->>Server: Send session token via data channel
    loop Every second
        Client->>Server: Send "ping" via data channel
    end
    Note over Client,Server: Audio/Video streaming and data exchange
```


## Run this Demo

Step 1: create .env file in root directory
```
REACT_APP_SIMLI_KEY="YOUR-SIMLI-API-KEY"
REACT_APP_RETELL_KEY="YOUR-RETELL-API-KEY"
```
Step 2: Update agentID and FaceID in `src/App.tsx`
```js
const agentId = "YOUR-RETELL-AGENT-ID";
const faceId = "YOUR-SIMLI-FACE-ID"; 
```

Step 3: `npm install`

Step 4: `npm start`

Step 5: open a new terminal and run `node server.js`
