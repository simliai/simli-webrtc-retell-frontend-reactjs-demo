import{EventEmitter as t}from"eventemitter3";import e from"isomorphic-ws";class n extends t{constructor(t){super(),this.ws=void 0,this.pingTimeout=null,this.pingInterval=null,this.wasDisconnected=!1,this.pingIntervalTime=5e3;let n=(t.customEndpoint||"wss://api.retellai.com/audio-websocket/")+t.callId;t.enableUpdate&&(n+="?enable_update=true"),this.ws=new e(n),this.ws.binaryType="arraybuffer",this.ws.onopen=()=>{this.emit("open"),this.startPingPong()},this.ws.onmessage=t=>{if("string"==typeof t.data)if("pong"===t.data)this.wasDisconnected&&(this.emit("reconnect"),this.wasDisconnected=!1),this.adjustPingFrequency(5e3);else if("clear"===t.data)this.emit("clear");else try{const e=JSON.parse(t.data);"update"===e.event_type?this.emit("update",e):"metadata"===e.event_type&&this.emit("metadata",e)}catch(t){console.log(t)}else if(t.data instanceof ArrayBuffer){const e=new Uint8Array(t.data);this.emit("audio",e)}else console.log("error","Got unknown message from server.")},this.ws.onclose=t=>{this.stopPingPong(),this.emit("close",t.code,t.reason)},this.ws.onerror=t=>{this.stopPingPong(),this.emit("error",t.error)}}startPingPong(){this.pingInterval=setInterval(()=>this.sendPing(),this.pingIntervalTime),this.resetPingTimeout()}sendPing(){this.ws.readyState===e.OPEN&&this.ws.send("ping")}adjustPingFrequency(t){this.pingIntervalTime!==t&&(null!=this.pingInterval&&clearInterval(this.pingInterval),this.pingIntervalTime=t,this.startPingPong())}resetPingTimeout(){null!=this.pingTimeout&&clearTimeout(this.pingTimeout),this.pingTimeout=setTimeout(()=>{5e3===this.pingIntervalTime&&(this.adjustPingFrequency(1e3),this.pingTimeout=setTimeout(()=>{this.emit("disconnect"),this.wasDisconnected=!0},3e3))},this.pingIntervalTime)}stopPingPong(){null!=this.pingInterval&&clearInterval(this.pingInterval),null!=this.pingTimeout&&clearTimeout(this.pingTimeout)}send(t){1===this.ws.readyState&&this.ws.send(t)}close(){this.ws.close()}}function i(t){const e=new ArrayBuffer(2*t.length),n=new DataView(e);for(let e=0;e<t.length;e++)n.setInt16(2*e,32768*t[e],!0);return new Uint8Array(e)}function a(t,e){try{var n=t()}catch(t){return e(t)}return n&&n.then?n.then(void 0,e):n}class s extends t{constructor(t){super(),this.liveClient=void 0,this.audioContext=void 0,this.isCalling=!1,this.stream=void 0,this.audioNode=void 0,this.customEndpoint=void 0,this.captureNode=null,this.audioData=[],this.audioDataIndex=0,this.isTalking=!1,t&&(this.customEndpoint=t)}startConversation(t){try{const e=this,i=a(function(){return Promise.resolve(e.setupAudioPlayback(t.sampleRate,t.customStream)).then(function(){e.liveClient=new n({callId:t.callId,enableUpdate:t.enableUpdate,customEndpoint:e.customEndpoint}),e.handleAudioEvents(),e.isCalling=!0})},function(t){e.emit("error",t.message)});return Promise.resolve(i&&i.then?i.then(function(){}):void 0)}catch(t){return Promise.reject(t)}}stopConversation(){var t,e,n,i,a;this.isCalling=!1,null==(t=this.liveClient)||t.close(),null==(e=this.audioContext)||e.suspend(),null==(n=this.audioContext)||n.close(),this.isAudioWorkletSupported()?(null==(a=this.audioNode)||a.disconnect(),this.audioNode=null):this.captureNode&&(this.captureNode.disconnect(),this.captureNode.onaudioprocess=null,this.captureNode=null,this.audioData=[],this.audioDataIndex=0),this.liveClient=null,null==(i=this.stream)||i.getTracks().forEach(t=>t.stop()),this.audioContext=null,this.stream=null}handleAudioEvents(){this.liveClient.on("open",()=>{this.emit("conversationStarted")}),this.liveClient.on("audio",t=>{this.emit("audio",t),this.isTalking||(this.isTalking=!0,this.emit("agentStartTalking"))}),this.liveClient.on("disconnect",()=>{this.emit("disconnect")}),this.liveClient.on("reconnect",()=>{this.emit("reconnect")}),this.liveClient.on("error",t=>{this.emit("error",t),this.isCalling&&this.stopConversation()}),this.liveClient.on("close",(t,e)=>{this.isCalling&&this.stopConversation(),this.emit("conversationEnded",{code:t,reason:e})}),this.liveClient.on("update",t=>{this.emit("update",t)}),this.liveClient.on("metadata",t=>{this.emit("metadata",t)}),this.liveClient.on("clear",()=>{this.isAudioWorkletSupported()?this.audioNode.port.postMessage("clear"):(this.audioData=[],this.audioDataIndex=0,this.isTalking&&(this.isTalking=!1,this.emit("agentStopTalking")))})}setupAudioPlayback(t,e){try{const n=this;function s(t){const e=function(){if(n.isAudioWorkletSupported()){console.log("Audio worklet starting"),n.audioContext.resume();const t=new Blob(['\nclass captureAndPlaybackProcessor extends AudioWorkletProcessor {\n    audioData = [];\n    index = 0;\n    isTalking = false;\n  \n    constructor() {\n      super();\n      //set listener to receive audio data, data is float32 array.\n      this.port.onmessage = (e) => {\n        if (e.data === "clear") {\n          // Clear all buffer.\n          this.audioData = [];\n          this.index = 0;\n          if (this.isTalking) {\n            this.isTalking = false;\n            this.port.postMessage("agent_stop_talking");\n          }\n        } else if (e.data.length > 0) {\n          this.audioData.push(this.convertUint8ToFloat32(e.data));\n          if (!this.isTalking) {\n            this.isTalking = true;\n            this.port.postMessage("agent_start_talking");\n          }\n        }\n      };\n    }\n  \n    convertUint8ToFloat32(array) {\n      const targetArray = new Float32Array(array.byteLength / 2);\n    \n      // A DataView is used to read our 16-bit little-endian samples out of the Uint8Array buffer\n      const sourceDataView = new DataView(array.buffer);\n    \n      // Loop through, get values, and divide by 32,768\n      for (let i = 0; i < targetArray.length; i++) {\n        targetArray[i] = sourceDataView.getInt16(i * 2, true) / Math.pow(2, 16 - 1);\n      }\n      return targetArray;\n    }\n  \n    convertFloat32ToUint8(array) {\n      const buffer = new ArrayBuffer(array.length * 2);\n      const view = new DataView(buffer);\n    \n      for (let i = 0; i < array.length; i++) {\n        const value = array[i] * 32768;\n        view.setInt16(i * 2, value, true); // true for little-endian\n      }\n    \n      return new Uint8Array(buffer);\n    }\n  \n    process(inputs, outputs, parameters) {\n      // Capture\n      const input = inputs[0];\n      const inputChannel1 = input[0];\n      const inputChannel2 = input[1];\n      this.port.postMessage(["capture", this.convertFloat32ToUint8(inputChannel1)]);\n  \n      // Playback\n      const output = outputs[0];\n      const outputChannel1 = output[0];\n      const outputChannel2 = output[1];\n      // start playback.\n      for (let i = 0; i < outputChannel1.length; ++i) {\n        if (this.audioData.length > 0) {\n          outputChannel1[i] = this.audioData[0][this.index];\n          outputChannel2[i] = this.audioData[0][this.index];\n          this.index++;\n          if (this.index == this.audioData[0].length) {\n            this.audioData.shift();\n            this.index = 0;\n          }\n        } else {\n          outputChannel1[i] = 0;\n          outputChannel2[i] = 0;\n        }\n      }\n\n      this.port.postMessage(["playback", this.convertFloat32ToUint8(outputChannel1)]);\n      if (!this.audioData.length && this.isTalking) {\n        this.isTalking = false;\n        this.port.postMessage("agent_stop_talking");\n      }\n  \n      return true;\n    }\n  }\n  \n  registerProcessor(\n    "capture-and-playback-processor",\n    captureAndPlaybackProcessor,\n  );\n'],{type:"application/javascript"}),e=URL.createObjectURL(t);return Promise.resolve(n.audioContext.audioWorklet.addModule(e)).then(function(){console.log("Audio worklet loaded"),n.audioNode=new AudioWorkletNode(n.audioContext,"capture-and-playback-processor"),console.log("Audio worklet setup"),n.audioNode.port.onmessage=t=>{let e=t.data;if(Array.isArray(e)){let t=e[0];var i;"capture"===t?null==(i=n.liveClient)||i.send(e[1]):"playback"===t&&n.emit("audio",e[1])}else"agent_stop_talking"===e?n.emit("agentStopTalking"):"agent_start_talking"===e&&n.emit("agentStartTalking")},n.audioContext.createMediaStreamSource(n.stream).connect(n.audioNode),n.audioNode.connect(n.audioContext.destination)})}{const t=n.audioContext.createMediaStreamSource(n.stream);n.captureNode=n.audioContext.createScriptProcessor(2048,1,1),n.captureNode.onaudioprocess=t=>{if(n.isCalling){const e=i(t.inputBuffer.getChannelData(0));n.liveClient.send(e);const a=t.outputBuffer.getChannelData(0);for(let t=0;t<a.length;++t)n.audioData.length>0?(a[t]=n.audioData[0][n.audioDataIndex++],n.audioDataIndex===n.audioData[0].length&&(n.audioData.shift(),n.audioDataIndex=0)):a[t]=0;n.emit("audio",i(a)),!n.audioData.length&&n.isTalking&&(n.isTalking=!1,n.emit("agentStopTalking"))}},t.connect(n.captureNode),n.captureNode.connect(n.audioContext.destination)}}();if(e&&e.then)return e.then(function(){})}n.audioContext=new AudioContext({sampleRate:t});const o=a(function(){function i(t){n.stream=t}return e?i(e):Promise.resolve(navigator.mediaDevices.getUserMedia({audio:{sampleRate:t,echoCancellation:!0,noiseSuppression:!0,channelCount:1}})).then(i)},function(){throw new Error("User didn't give microphone permission")});return Promise.resolve(o&&o.then?o.then(s):s())}catch(r){return Promise.reject(r)}}isAudioWorkletSupported(){return/Chrome/.test(navigator.userAgent)&&/Google Inc/.test(navigator.vendor)}playAudio(t){if(this.isAudioWorkletSupported())this.audioNode.port.postMessage(t);else{const e=function(t){const e=new Float32Array(t.byteLength/2),n=new DataView(t.buffer);for(let t=0;t<e.length;t++)e[t]=n.getInt16(2*t,!0)/Math.pow(2,15);return e}(t);this.audioData.push(e),this.isTalking||(this.isTalking=!0,this.emit("agentStartTalking"))}}}export{s as RetellWebClient};
