export declare const workletCode = "\nclass captureAndPlaybackProcessor extends AudioWorkletProcessor {\n    audioData = [];\n    index = 0;\n    isTalking = false;\n  \n    constructor() {\n      super();\n      //set listener to receive audio data, data is float32 array.\n      this.port.onmessage = (e) => {\n        if (e.data === \"clear\") {\n          // Clear all buffer.\n          this.audioData = [];\n          this.index = 0;\n          if (this.isTalking) {\n            this.isTalking = false;\n            this.port.postMessage(\"agent_stop_talking\");\n          }\n        } else if (e.data.length > 0) {\n          this.audioData.push(this.convertUint8ToFloat32(e.data));\n          if (!this.isTalking) {\n            this.isTalking = true;\n            this.port.postMessage(\"agent_start_talking\");\n          }\n        }\n      };\n    }\n  \n    convertUint8ToFloat32(array) {\n      const targetArray = new Float32Array(array.byteLength / 2);\n    \n      // A DataView is used to read our 16-bit little-endian samples out of the Uint8Array buffer\n      const sourceDataView = new DataView(array.buffer);\n    \n      // Loop through, get values, and divide by 32,768\n      for (let i = 0; i < targetArray.length; i++) {\n        targetArray[i] = sourceDataView.getInt16(i * 2, true) / Math.pow(2, 16 - 1);\n      }\n      return targetArray;\n    }\n  \n    convertFloat32ToUint8(array) {\n      const buffer = new ArrayBuffer(array.length * 2);\n      const view = new DataView(buffer);\n    \n      for (let i = 0; i < array.length; i++) {\n        const value = array[i] * 32768;\n        view.setInt16(i * 2, value, true); // true for little-endian\n      }\n    \n      return new Uint8Array(buffer);\n    }\n  \n    process(inputs, outputs, parameters) {\n      // Capture\n      const input = inputs[0];\n      const inputChannel1 = input[0];\n      const inputChannel2 = input[1];\n      this.port.postMessage([\"capture\", this.convertFloat32ToUint8(inputChannel1)]);\n  \n      // Playback\n      const output = outputs[0];\n      const outputChannel1 = output[0];\n      const outputChannel2 = output[1];\n      // start playback.\n      for (let i = 0; i < outputChannel1.length; ++i) {\n        if (this.audioData.length > 0) {\n          outputChannel1[i] = this.audioData[0][this.index];\n          outputChannel2[i] = this.audioData[0][this.index];\n          this.index++;\n          if (this.index == this.audioData[0].length) {\n            this.audioData.shift();\n            this.index = 0;\n          }\n        } else {\n          outputChannel1[i] = 0;\n          outputChannel2[i] = 0;\n        }\n      }\n\n      this.port.postMessage([\"playback\", this.convertFloat32ToUint8(outputChannel1)]);\n      if (!this.audioData.length && this.isTalking) {\n        this.isTalking = false;\n        this.port.postMessage(\"agent_stop_talking\");\n      }\n  \n      return true;\n    }\n  }\n  \n  registerProcessor(\n    \"capture-and-playback-processor\",\n    captureAndPlaybackProcessor,\n  );\n";
