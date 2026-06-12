import { cleanIsbn, isBooklandIsbn13 } from './isbn.js';

export class ScannerController{
  constructor({
    win = window,
    nav = navigator,
    readerEl,
    logger,
    onIsbn,
    onReadout,
    onSkip,
    onState
  }){
    this.window = win;
    this.navigator = nav;
    this.readerEl = readerEl;
    this.logger = logger;
    this.onIsbn = onIsbn;
    this.onReadout = onReadout;
    this.onSkip = onSkip;
    this.onState = onState;
    this.stream = null;
    this.video = null;
    this.detector = null;
    this.usingQuagga = false;
    this.rafId = null;
    this.lastDetectAt = 0;
    this.lastIsbn = '';
    this.lastTime = 0;
    this.candidate = '';
    this.candidateHits = 0;
    this.heartbeatLast = 0;
    this.dotCount = 0;
    this.audioCtx = null;
    this.quaggaDetected = null;
    this.quaggaProcessed = null;
  }

  get scanning(){
    return Boolean(this.stream || this.usingQuagga || this.detector);
  }

  async toggle(){
    if(this.scanning){
      await this.stop();
      return { running: false };
    }
    return this.start();
  }

  async start(){
    this.ensureAudio();
    try{
      const native = await this.tryNativeDetector();
      if(!native) await this.startQuagga();
      this.onState(true);
      this.onReadout('Camera on (' + (native ? 'native' : 'Quagga') + ' engine). Hold the barcode 5-10 inches away.', 3000);
      if(this.logger) this.logger.info('scanner_started', { engine: native ? 'native' : 'quagga' });
      return { running: true, engine: native ? 'native' : 'quagga' };
    }catch(error){
      await this.stop();
      const category = error && error.category ? error.category : 'camera_unavailable';
      if(this.logger) this.logger.warn('scanner_failed', { category, message: error && error.message });
      throw { category, message: error && error.message ? error.message : 'Camera unavailable.' };
    }
  }

  async tryNativeDetector(){
    if(!('BarcodeDetector' in this.window)) return false;
    let formats = [];
    try{
      formats = await this.window.BarcodeDetector.getSupportedFormats();
    }catch(_err){
      return false;
    }
    if(!formats || !formats.includes('ean_13')) return false;

    this.detector = new this.window.BarcodeDetector({ formats: ['ean_13'] });
    this.stream = await this.navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false
    });
    this.video = this.document.createElement('video');
    this.video.setAttribute('playsinline', 'true');
    this.video.muted = true;
    this.video.style.width = '100%';
    this.video.style.borderRadius = '8px';
    this.readerEl.innerHTML = '';
    this.readerEl.appendChild(this.video);
    this.video.srcObject = this.stream;
    await this.video.play();
    await this.tuneTrack(this.stream.getVideoTracks()[0]);
    this.detectLoop();
    return true;
  }

  async startQuagga(){
    const quagga = this.window.Quagga;
    if(!quagga) throw { category: 'scanner_library_unavailable', message: 'Quagga did not load.' };
    this.usingQuagga = true;
    this.readerEl.innerHTML = '';
    await new Promise((resolve, reject) => {
      quagga.init({
        inputStream: {
          name: 'Live',
          type: 'LiveStream',
          target: this.readerEl,
          constraints: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }
        },
        locator: { patchSize: 'medium', halfSample: true },
        numOfWorkers: 0,
        frequency: 10,
        decoder: { readers: ['ean_reader'] },
        locate: true
      }, err => err ? reject(err) : resolve());
    });
    quagga.start();
    const video = this.readerEl.querySelector('video');
    if(video){
      video.setAttribute('playsinline', 'true');
      video.muted = true;
      video.style.width = '100%';
      video.style.borderRadius = '8px';
      const track = video.srcObject && video.srcObject.getVideoTracks ? video.srcObject.getVideoTracks()[0] : null;
      if(track) await this.tuneTrack(track);
    }
    this.quaggaProcessed = () => this.heartbeat();
    this.quaggaDetected = result => {
      const code = result && result.codeResult ? result.codeResult.code : '';
      if(code) this.acceptRead(code, false);
    };
    quagga.onProcessed(this.quaggaProcessed);
    quagga.onDetected(this.quaggaDetected);
  }

  detectLoop(){
    if(!this.detector || !this.video) return;
    this.rafId = this.window.requestAnimationFrame(() => this.detectLoop());
    const now = Date.now();
    if(now - this.lastDetectAt < 90) return;
    this.lastDetectAt = now;
    this.detector.detect(this.video).then(codes => {
      if(codes && codes.length) this.acceptRead(codes[0].rawValue, true);
      else this.heartbeat();
    }).catch(() => this.heartbeat());
  }

  acceptRead(raw, trusted){
    const digits = cleanIsbn(String(raw));
    if(!trusted){
      if(digits === this.candidate) this.candidateHits += 1;
      else{
        this.candidate = digits;
        this.candidateHits = 1;
      }
      if(this.candidateHits < 2){
        this.onReadout('Reading... ' + digits, 600);
        return;
      }
      this.candidate = '';
      this.candidateHits = 0;
    }
    this.handleIsbnRead(digits);
  }

  handleIsbnRead(isbn){
    if(!isBooklandIsbn13(isbn)){
      this.beep(220, 90, 0.15);
      this.onReadout('Read ' + isbn + ' - that is the price barcode. Slide to the 978/979 one.', 2200);
      this.onSkip('Skipped a price barcode - aim at the one starting 978 or 979');
      if(this.logger) this.logger.info('scanner_skipped_non_isbn', { raw: isbn });
      return;
    }
    const now = Date.now();
    if(isbn === this.lastIsbn && now - this.lastTime < 4000) return;
    this.lastIsbn = isbn;
    this.lastTime = now;
    this.beep(1175, 140, 0.25);
    if(this.navigator.vibrate) this.navigator.vibrate(60);
    this.onReadout('Read ISBN ' + isbn + ' - checking the catalog...', 3000);
    this.onIsbn(isbn);
  }

  heartbeat(){
    const now = Date.now();
    if(now - this.heartbeatLast < 600) return;
    this.heartbeatLast = now;
    this.dotCount = (this.dotCount + 1) % 4;
    this.onReadout('Looking for a barcode' + '.'.repeat(this.dotCount + 1), 0);
  }

  async tuneTrack(track){
    try{
      if(!track || !track.getCapabilities) return;
      const caps = track.getCapabilities();
      const adv = {};
      let any = false;
      if(caps.focusMode && Array.from(caps.focusMode).includes('continuous')){
        adv.focusMode = 'continuous';
        any = true;
      }
      if(caps.zoom && caps.zoom.max){
        adv.zoom = Math.min(2, caps.zoom.max);
        any = true;
      }
      if(any) await track.applyConstraints({ advanced: [adv] });
    }catch(error){
      if(this.logger) this.logger.info('camera_tuning_skipped', { message: error.message });
    }
  }

  async stop(){
    if(this.rafId){
      this.window.cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.detector = null;
    if(this.usingQuagga && this.window.Quagga){
      try{ this.window.Quagga.stop(); }catch(_err){}
      try{
        if(this.quaggaDetected) this.window.Quagga.offDetected(this.quaggaDetected);
        if(this.quaggaProcessed) this.window.Quagga.offProcessed(this.quaggaProcessed);
      }catch(_err){}
      this.usingQuagga = false;
    }
    if(this.stream){
      try{ this.stream.getTracks().forEach(track => track.stop()); }catch(_err){}
      this.stream = null;
    }
    this.readerEl.innerHTML = '';
    this.video = null;
    this.candidate = '';
    this.candidateHits = 0;
    this.onState(false);
    this.onReadout('', 0);
  }

  ensureAudio(){
    try{
      if(!this.audioCtx){
        const AudioCtor = this.window.AudioContext || this.window.webkitAudioContext;
        if(AudioCtor) this.audioCtx = new AudioCtor();
      }
      if(this.audioCtx && this.audioCtx.state === 'suspended') this.audioCtx.resume();
    }catch(_err){
      this.audioCtx = null;
    }
  }

  beep(freq, ms, vol){
    if(!this.audioCtx) return;
    try{
      const oscillator = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      oscillator.type = 'square';
      oscillator.frequency.value = freq;
      gain.gain.value = vol || 0.2;
      oscillator.connect(gain);
      gain.connect(this.audioCtx.destination);
      oscillator.start();
      setTimeout(() => {
        try{
          oscillator.stop();
          oscillator.disconnect();
          gain.disconnect();
        }catch(_err){}
      }, ms);
    }catch(_err){}
  }

  get document(){
    return this.readerEl.ownerDocument;
  }
}
