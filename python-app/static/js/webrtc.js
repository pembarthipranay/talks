/**
 * WebRTC and Media Hardware Utilities for Randomtalks
 */

let globalAudioCtx = null;
const analyserMap = new WeakMap();

export async function requestUserMedia(video = true, audio = true) {
  try {
    const constraints = {
      audio: audio ? { echoCancellation: true, noiseSuppression: true, autoGainControl: true } : false,
      video: video ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' } : false,
    };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    return { stream, error: null };
  } catch (err) {
    console.error('Media permission error:', err);
    let msg = 'Camera or microphone access was denied or hardware not found.';
    if (err.name === 'NotAllowedError') {
      msg = 'Permission denied. Please grant camera and microphone permissions in your browser.';
    } else if (err.name === 'NotFoundError') {
      msg = 'No camera or microphone device found on this system.';
    }
    return { stream: null, error: msg };
  }
}

export function stopMediaStream(stream) {
  if (!stream) return;
  stream.getTracks().forEach((track) => {
    try {
      track.stop();
      stopSpeakingDetector(track);
    } catch (e) {
      console.warn('Error stopping track:', e);
    }
  });
}

export function startSpeakingDetector(audioTrack, onSpeakingChange, threshold = 0.035) {
  try {
    if (!globalAudioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      globalAudioCtx = new AudioContextClass();
    }
    if (globalAudioCtx.state === 'suspended') {
      globalAudioCtx.resume();
    }

    const sourceStream = new MediaStream([audioTrack]);
    const source = globalAudioCtx.createMediaStreamSource(sourceStream);
    const analyser = globalAudioCtx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    let isSpeaking = false;
    let silenceTicks = 0;

    const intervalId = window.setInterval(() => {
      analyser.getByteFrequencyData(dataArray);
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        sum += dataArray[i];
      }
      const avg = sum / bufferLength / 255;

      if (avg > threshold) {
        silenceTicks = 0;
        if (!isSpeaking) {
          isSpeaking = true;
          onSpeakingChange(true);
        }
      } else {
        silenceTicks++;
        if (silenceTicks > 6 && isSpeaking) {
          isSpeaking = false;
          onSpeakingChange(false);
        }
      }
    }, 120);

    analyserMap.set(audioTrack, { analyser, intervalId });
  } catch (e) {
    console.warn('Could not start speaking detector:', e);
  }
}

export function stopSpeakingDetector(audioTrack) {
  const item = analyserMap.get(audioTrack);
  if (item) {
    window.clearInterval(item.intervalId);
    analyserMap.delete(audioTrack);
  }
}

export class PeerConnectionWrapper {
  constructor(iceServers, onTrack, onIceCandidate, onConnectionStateChange) {
    const defaultServers = [{ urls: 'stun:stun.l.google.com:19302' }];
    const resolvedServers = iceServers && iceServers.length > 0 ? iceServers : defaultServers;

    this.pc = new RTCPeerConnection({
      iceServers: resolvedServers,
      iceCandidatePoolSize: 2,
    });

    this.candidateQueue = [];
    this.remoteDescriptionSet = false;

    this.pc.ontrack = onTrack;

    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        onIceCandidate(event.candidate);
      }
    };

    if (onConnectionStateChange) {
      const handleState = () => {
        const cState = this.pc.connectionState;
        const iState = this.pc.iceConnectionState;
        if (cState === 'connected' || iState === 'connected' || iState === 'completed') {
          onConnectionStateChange('connected');
        } else if (cState === 'failed' || iState === 'failed') {
          onConnectionStateChange('failed');
        } else if (cState === 'disconnected' || iState === 'disconnected') {
          onConnectionStateChange('disconnected');
        } else {
          onConnectionStateChange(cState);
        }
      };

      this.pc.onconnectionstatechange = handleState;
      this.pc.oniceconnectionstatechange = handleState;
    }
  }

  addTracks(stream) {
    if (!stream) return;
    stream.getTracks().forEach((track) => {
      try {
        this.pc.addTrack(track, stream);
      } catch (e) {
        console.warn('Failed adding track:', e);
      }
    });
  }

  async createOffer() {
    const offer = await this.pc.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true,
    });
    await this.pc.setLocalDescription(offer);
    return offer;
  }

  async createAnswer() {
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    return answer;
  }

  async setRemoteDescription(desc) {
    await this.pc.setRemoteDescription(new RTCSessionDescription(desc));
    this.remoteDescriptionSet = true;

    while (this.candidateQueue.length > 0) {
      const c = this.candidateQueue.shift();
      if (c) {
        try {
          await this.pc.addIceCandidate(c);
        } catch (e) {
          console.warn('Failed buffered candidate:', e);
        }
      }
    }
  }

  async addIceCandidate(candidate) {
    if (!candidate) return;
    if (this.remoteDescriptionSet && this.pc.remoteDescription) {
      try {
        await this.pc.addIceCandidate(candidate);
      } catch (e) {
        console.warn('Failed adding candidate:', e);
      }
    } else {
      this.candidateQueue.push(candidate);
    }
  }

  close() {
    try {
      this.pc.close();
    } catch (e) {
      // ignore
    }
  }
}
