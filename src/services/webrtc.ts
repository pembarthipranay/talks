import { IceServerConfig } from '../types.ts';

export interface MediaDeviceState {
  stream: MediaStream | null;
  audioTrack: MediaStreamTrack | null;
  videoTrack: MediaStreamTrack | null;
  isAudioEnabled: boolean;
  isVideoEnabled: boolean;
  hasPermission: boolean;
  error: string | null;
}

// Global AudioContext for volume / speech detection
let audioContext: AudioContext | null = null;
let analyserMap = new WeakMap<MediaStreamTrack, { analyser: AnalyserNode; intervalId: number }>();

export async function requestUserMedia(
  video: boolean = true,
  audio: boolean = true
): Promise<{ stream: MediaStream | null; error: string | null; isAudioOnly?: boolean }> {
  try {
    const constraints: MediaStreamConstraints = {
      audio: audio ? { echoCancellation: true, noiseSuppression: true, autoGainControl: true } : false,
      video: video ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' } : false,
    };

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    return { stream, error: null, isAudioOnly: !video };
  } catch (err: any) {
    console.warn('Initial media request failed, attempting fallback:', err);
    // If video + audio failed, attempt audio-only fallback automatically
    if (video && audio) {
      try {
        const audioOnlyStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          video: false,
        });
        return { stream: audioOnlyStream, error: null, isAudioOnly: true };
      } catch (audioErr: any) {
        console.warn('Audio-only fallback also failed:', audioErr);
      }
    }

    let errorMessage = 'Permission denied or media hardware unavailable.';
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      errorMessage = 'Camera or microphone access was denied. Please allow permission in your browser or continue in text mode.';
    } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
      errorMessage = 'No camera or microphone found on this device.';
    } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
      errorMessage = 'Camera or microphone is currently in use by another app.';
    }
    return { stream: null, error: errorMessage };
  }
}

// Generate an empty synthetic silent audio track for users who want to connect without microphone hardware
export function createSyntheticStream(): MediaStream {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const dst = osc.connect(ctx.createMediaStreamDestination()) as any;
    osc.start();
    const track = dst.stream.getAudioTracks()[0];
    track.enabled = false; // Muted by default
    return new MediaStream([track]);
  } catch (e) {
    return new MediaStream();
  }
}

export async function flipCameraStream(
  currentStream: MediaStream,
  targetFacingMode: 'user' | 'environment'
): Promise<{ newStream: MediaStream; newTrack: MediaStreamTrack | null; error: string | null }> {
  try {
    const currentVideoTrack = currentStream.getVideoTracks()[0];
    if (currentVideoTrack) {
      currentVideoTrack.stop();
      currentStream.removeTrack(currentVideoTrack);
    }

    const newMedia = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: targetFacingMode,
      },
      audio: false,
    });

    const newVideoTrack = newMedia.getVideoTracks()[0];
    if (newVideoTrack) {
      currentStream.addTrack(newVideoTrack);
    }
    return { newStream: currentStream, newTrack: newVideoTrack || null, error: null };
  } catch (err: any) {
    console.error('Failed to flip camera:', err);
    return { newStream: currentStream, newTrack: null, error: 'Could not switch camera.' };
  }
}

export function stopMediaStream(stream: MediaStream | null) {
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

// Real-time speaking detection
export function startSpeakingDetector(
  audioTrack: MediaStreamTrack,
  onSpeakingChange: (isSpeaking: boolean) => void,
  threshold: number = 0.04
) {
  try {
    if (!audioContext) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      audioContext = new AudioCtx();
    }
    if (audioContext.state === 'suspended') {
      audioContext.resume();
    }

    const sourceStream = new MediaStream([audioTrack]);
    const source = audioContext.createMediaStreamSource(sourceStream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    let isSpeaking = false;
    let silenceCounter = 0;

    const intervalId = window.setInterval(() => {
      analyser.getByteFrequencyData(dataArray);
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        sum += dataArray[i];
      }
      const average = sum / bufferLength / 255;

      if (average > threshold) {
        silenceCounter = 0;
        if (!isSpeaking) {
          isSpeaking = true;
          onSpeakingChange(true);
        }
      } else {
        silenceCounter++;
        // debounce silence
        if (silenceCounter > 5 && isSpeaking) {
          isSpeaking = false;
          onSpeakingChange(false);
        }
      }
    }, 150);

    analyserMap.set(audioTrack, { analyser, intervalId });
  } catch (err) {
    console.warn('Audio speaking detection not available:', err);
  }
}

export function stopSpeakingDetector(audioTrack: MediaStreamTrack) {
  const record = analyserMap.get(audioTrack);
  if (record) {
    clearInterval(record.intervalId);
    analyserMap.delete(audioTrack);
  }
}

// Safe PeerConnection helper with candidate queuing
export class PeerConnectionWrapper {
  public pc: RTCPeerConnection;
  private candidateQueue: RTCIceCandidateInit[] = [];
  private remoteDescriptionSet = false;

  constructor(
    iceServers: IceServerConfig[] | RTCIceServer[],
    onTrack: (event: RTCTrackEvent) => void,
    onIceCandidate: (candidate: RTCIceCandidate) => void,
    onConnectionStateChange?: (state: RTCPeerConnectionState) => void
  ) {
    // Reliable fallback STUN servers
    const resolvedIceServers: RTCIceServer[] =
      iceServers && iceServers.length > 0
        ? (iceServers as RTCIceServer[])
        : [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
            { urls: 'stun:stun3.l.google.com:19302' },
            { urls: 'stun:stun4.l.google.com:19302' },
            { urls: 'stun:global.stun.twilio.com:3478' },
          ];

    const config: RTCConfiguration = {
      iceServers: resolvedIceServers,
      iceCandidatePoolSize: 2,
    };

    this.pc = new RTCPeerConnection(config);

    this.pc.ontrack = onTrack;

    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        onIceCandidate(event.candidate);
      }
    };

    if (onConnectionStateChange) {
      const handleStateCheck = () => {
        const connState = this.pc.connectionState;
        const iceState = this.pc.iceConnectionState;
        console.log(`[WebRTC State] Connection: ${connState}, ICE: ${iceState}`);
        if (connState === 'connected' || iceState === 'connected' || iceState === 'completed') {
          onConnectionStateChange('connected');
        } else if (connState === 'failed' || iceState === 'failed') {
          onConnectionStateChange('failed');
        } else if (connState === 'disconnected' || iceState === 'disconnected') {
          onConnectionStateChange('disconnected');
        } else {
          onConnectionStateChange(connState);
        }
      };

      this.pc.onconnectionstatechange = handleStateCheck;
      this.pc.oniceconnectionstatechange = handleStateCheck;
    }
  }

  public addTracks(stream: MediaStream) {
    stream.getTracks().forEach((track) => {
      try {
        this.pc.addTrack(track, stream);
      } catch (err) {
        console.warn('Track already added or failed:', err);
      }
    });
  }

  public async replaceTrack(newTrack: MediaStreamTrack) {
    const sender = this.pc.getSenders().find((s) => s.track && s.track.kind === newTrack.kind);
    if (sender) {
      try {
        await sender.replaceTrack(newTrack);
      } catch (err) {
        console.warn('Failed to replace track on peer:', err);
      }
    }
  }

  public async setRemoteDescription(desc: RTCSessionDescriptionInit) {
    await this.pc.setRemoteDescription(new RTCSessionDescription(desc));
    this.remoteDescriptionSet = true;

    // Process queued candidates
    while (this.candidateQueue.length > 0) {
      const candidate = this.candidateQueue.shift();
      if (candidate) {
        try {
          await this.pc.addIceCandidate(candidate);
        } catch (e) {
          console.warn('Failed to add buffered ICE candidate:', e);
        }
      }
    }
  }

  public async addIceCandidate(candidate: RTCIceCandidateInit | RTCIceCandidate) {
    if (!candidate) return;
    if (this.remoteDescriptionSet && this.pc.remoteDescription) {
      try {
        await this.pc.addIceCandidate(candidate);
      } catch (e) {
        console.warn('Failed to add ICE candidate:', e);
      }
    } else {
      this.candidateQueue.push(candidate);
    }
  }

  public async createOffer(): Promise<RTCSessionDescriptionInit> {
    const offer = await this.pc.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true,
    });
    await this.pc.setLocalDescription(offer);
    return offer;
  }

  public async createAnswer(): Promise<RTCSessionDescriptionInit> {
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    return answer;
  }

  public close() {
    try {
      this.pc.close();
    } catch (e) {
      // ignore
    }
  }
}

// Image sharing helper: checks file size (<= 5MB) and converts to optimized base64
export function processImageUpload(
  file: File,
  maxSizeMB: number = 5
): Promise<{ dataUrl: string | null; error: string | null }> {
  return new Promise((resolve) => {
    if (!file.type.startsWith('image/')) {
      return resolve({ dataUrl: null, error: 'Please select a valid image file (JPEG, PNG, WEBP, GIF).' });
    }

    const maxSizeBytes = maxSizeMB * 1024 * 1024;
    if (file.size > maxSizeBytes) {
      return resolve({
        dataUrl: null,
        error: `Image exceeds maximum allowed size (${maxSizeMB} MB).`,
      });
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      resolve({ dataUrl, error: null });
    };
    reader.onerror = () => {
      resolve({ dataUrl: null, error: 'Failed to read image file.' });
    };
    reader.readAsDataURL(file);
  });
}
