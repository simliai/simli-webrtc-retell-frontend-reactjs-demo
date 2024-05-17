import { EventEmitter as e } from "eventemitter3";
import t from "isomorphic-ws";
function n(e, t) {
  (e.prototype = Object.create(t.prototype)),
    (e.prototype.constructor = e),
    o(e, t);
}
function o(e, t) {
  return (
    (o = Object.setPrototypeOf
      ? Object.setPrototypeOf.bind()
      : function (e, t) {
          return (e.__proto__ = t), e;
        }),
    o(e, t)
  );
}
var r = /*#__PURE__*/ (function (e) {
  function o(n) {
    var o;
    (o = e.call(this) || this).ws = void 0;
    var r =
      (n.customEndpoint || "wss://api.retellai.com/audio-websocket/") +
      n.callId;
    return (
      n.enableUpdate && (r += "?enable_update=true"),
      (o.ws = new t(r)),
      (o.ws.binaryType = "arraybuffer"),
      (o.ws.onopen = function () {
        o.emit("open");
      }),
      (o.ws.onmessage = function (e) {
        if ("string" == typeof e.data)
          if ("clear" === e.data) o.emit("clear");
          else
            try {
              var t = JSON.parse(e.data);
              o.emit("update", t);
            } catch (e) {
              o.emit("error", "Error parsing JSON update from server."),
                o.ws.close(1002, "Error parsing JSON update from server.");
            }
        else if (e.data instanceof ArrayBuffer) {
          var n = new Uint8Array(e.data);
          o.emit("audio", n);
        } else
          o.emit("error", "Got unknown message from server."),
            o.ws.close(1002, "Got unknown message from server.");
      }),
      (o.ws.onclose = function (e) {
        o.emit("close", e.code, e.reason);
      }),
      (o.ws.onerror = function (e) {
        o.emit("error", e.error);
      }),
      o
    );
  }
  n(o, e);
  var r = o.prototype;
  return (
    (r.send = function (e) {
      1 === this.ws.readyState && this.ws.send(e);
    }),
    (r.close = function () {
      this.ws.close();
    }),
    o
  );
})(e);
function i(e, t) {
  try {
    var n = e();
  } catch (e) {
    return t(e);
  }
  return n && n.then ? n.then(void 0, t) : n;
}
var a = /*#__PURE__*/ (function (e) {
  function t() {
    var t;
    return (
      ((t = e.call(this) || this).liveClient = void 0),
      (t.audioContext = void 0),
      (t.isCalling = !1),
      (t.stream = void 0),
      (t.audioNode = void 0),
      t
    );
  }
  n(t, e);
  var o = t.prototype;
  return (
    (o.startConversation = function (e) {
      try {
        var t = this,
          n = i(
            function () {
              return Promise.resolve(
                t.setupAudio(e.sampleRate, e.customStream)
              ).then(function () {
                (t.liveClient = new r({
                  callId: e.callId,
                  enableUpdate: e.enableUpdate,
                })),
                  t.handleAudioEvents(),
                  (t.isCalling = !0);
              });
            },
            function (e) {
              t.emit("error", e.message);
            }
          );
        return Promise.resolve(n && n.then ? n.then(function () {}) : void 0);
      } catch (e) {
        return Promise.reject(e);
      }
    }),
    (o.stopConversation = function () {
      var e, t, n, o, r;
      (this.isCalling = !1),
        null == (e = this.liveClient) || e.close(),
        null == (t = this.audioContext) || t.suspend(),
        null == (n = this.audioNode) || n.disconnect(),
        delete this.audioNode,
        null == (o = this.audioContext) || o.close(),
        null == (r = this.stream) ||
          r.getTracks().forEach(function (e) {
            return e.stop();
          }),
        delete this.liveClient,
        delete this.audioContext,
        delete this.stream;
    }),
    (o.setupAudio = function (e, t) {
      try {
        var n = function (e) {
            console.log("Audio worklet starting"), o.audioContext.resume();   
            var t = new Blob(
                [
                  '\nclass captureAndPlaybackProcessor extends AudioWorkletProcessor {\n    audioData = [];\n    index = 0;\n  \n    constructor() {\n      super();\n      //set listener to receive audio data, data is float32 array.\n      this.port.onmessage = (e) => {\n        if (e.data === "clear") {\n          // Clear all buffer.\n          this.audioData = [];\n          this.index = 0;\n        } else if (e.data.length > 0) {\n          this.audioData.push(this.convertUint8ToFloat32(e.data));\n        }\n      };\n    }\n  \n    convertUint8ToFloat32(array) {\n      const targetArray = new Float32Array(array.byteLength / 2);\n    \n      // A DataView is used to read our 16-bit little-endian samples out of the Uint8Array buffer\n      const sourceDataView = new DataView(array.buffer);\n    \n      // Loop through, get values, and divide by 32,768\n      for (let i = 0; i < targetArray.length; i++) {\n        targetArray[i] = sourceDataView.getInt16(i * 2, true) / Math.pow(2, 16 - 1);\n      }\n      return targetArray;\n    }\n  \n    convertFloat32ToUint8(array) {\n      const buffer = new ArrayBuffer(array.length * 2);\n      const view = new DataView(buffer);\n    \n      for (let i = 0; i < array.length; i++) {\n        const value = array[i] * 32768;\n        view.setInt16(i * 2, value, true); // true for little-endian\n      }\n    \n      return new Uint8Array(buffer);\n    }\n  \n    process(inputs, outputs, parameters) {\n      // Capture\n      const input = inputs[0];\n      const inputChannel1 = input[0];\n      this.port.postMessage(this.convertFloat32ToUint8(inputChannel1));\n  \n      // Playback\n      const output = outputs[0];\n      const outputChannel1 = output[0];\n      // start playback.\n      for (let i = 0; i < outputChannel1.length; ++i) {\n        if (this.audioData.length > 0) {\n          outputChannel1[i] = this.audioData[0][this.index];\n          this.index++;\n          if (this.index == this.audioData[0].length) {\n            this.audioData.shift();\n            this.index = 0;\n          }\n        } else {\n          outputChannel1[i] = 0;\n        }\n      }\n  \n      return true;\n    }\n  }\n  \n  registerProcessor(\n    "capture-and-playback-processor",\n    captureAndPlaybackProcessor,\n  );\n',
                ],
                { type: "application/javascript" }
              ),
              n = URL.createObjectURL(t);
            return Promise.resolve(
              o.audioContext.audioWorklet.addModule(n)
            ).then(function () {
              console.log("Audio worklet loaded"),
                (o.audioNode = new AudioWorkletNode(
                  o.audioContext,
                  "capture-and-playback-processor"
                )),
                console.log("Audio worklet setup"),
                (o.audioNode.port.onmessage = function (e) {
                  null != o.liveClient && o.liveClient.send(e.data);
                }),
                o.audioContext
                  .createMediaStreamSource(o.stream)
                  .connect(o.audioNode),
                o.audioNode.connect(o.audioContext.destination);
            });
          },
          o = this;
        o.audioContext = new AudioContext({ sampleRate: e });
        var r = i(
          function () {
            function n(e) {
              o.stream = e;
            }
            return t
              ? n(t)
              : Promise.resolve(
                  navigator.mediaDevices.getUserMedia({
                    audio: {
                      sampleRate: e,
                      echoCancellation: !0,
                      noiseSuppression: !0,
                      channelCount: 1,
                    },
                  })
                ).then(n);
          },
          function () {
            throw new Error("User didn't give microphone permission");
          }
        );
        return Promise.resolve(r && r.then ? r.then(n) : n());
      } catch (e) {
        return Promise.reject(e);
      }
    }),
    (o.handleAudioEvents = function () {
      var e = this;
      this.liveClient.on("open", function () {
        e.emit("conversationStarted");
      }),
        this.liveClient.on("audio", function (t) {
        //   e.audioNode.port.postMessage(t);
          e.emit("audio", t);
        }),
        this.liveClient.on("error", function (t) {
          e.emit("error", t), e.isCalling && e.stopConversation();
        }),
        this.liveClient.on("close", function (t, n) {
          e.isCalling && e.stopConversation(),
            e.emit("conversationEnded", { code: t, reason: n });
        }),
        this.liveClient.on("update", function (t) {
          e.emit("update", t);
        }),
        this.liveClient.on("clear", function () {
          e.audioNode.port.postMessage("clear");
        });
    }),
    t
  );
})(e);
export { a as RetellWebClient };
