export function getTerminalHtml(wsUrl: string, token: string, sessionId: string) {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/css/xterm.min.css"/>
<style>
*{margin:0;padding:0;box-sizing:border-box;}
html,body{height:100%;overflow:hidden;background:#0f0f1a;}
#terminal{height:100%;width:100%;}
.xterm{height:100%;padding:4px;}
</style>
</head>
<body>
<div id="terminal"></div>
<script src="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/lib/xterm.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0.10.0/lib/addon-fit.min.js"></script>
<script>
(function(){
  var term = new Terminal({
    cursorBlink: true,
    fontSize: 13,
    fontFamily: 'Menlo, monospace',
    theme: {background:'#0f0f1a',foreground:'#e0e0e0',cursor:'#e94560'}
  });
  var fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  term.open(document.getElementById('terminal'));
  fitAddon.fit();

  var seq = 0;
  function nextSeq(){return ++seq;}
  function sendMsg(msg){
    if(ws&&ws.readyState===1) ws.send(JSON.stringify(msg));
  }

  var wsUrl = ${JSON.stringify(wsUrl)};
  var token = ${JSON.stringify(token)};
  var sessionId = ${JSON.stringify(sessionId)};
  var separator = wsUrl.indexOf('?')>=0?'&':'?';
  var url = wsUrl+separator+'token='+encodeURIComponent(token);

  var ws = new WebSocket(url);
  ws.binaryType = 'arraybuffer';

  ws.onopen = function(){
    window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({type:'status',status:'connected'}));
    sendMsg({type:'attach',seq:nextSeq(),payload:{target:sessionId,cols:term.cols,rows:term.rows}});
  };

  ws.onmessage = function(evt){
    if(evt.data instanceof ArrayBuffer){
      term.write(new Uint8Array(evt.data));
      return;
    }
    try{
      var msg=JSON.parse(evt.data);
      if(msg.type==='attached'){
        window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({type:'status',status:'attached'}));
      } else if(msg.type==='resized'){
        // On mobile the terminal always fits its container via fitAddon.fit().
        // The server-mandated size is used for PTY output formatting but we
        // don't override the fitted size here — that would break keyboard focus.
      } else if(msg.type==='detached'){
        window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({type:'status',status:'detached',reason:msg.payload.reason}));
      } else if(msg.type==='error'){
        window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({type:'error',message:msg.payload.message}));
      }
    }catch(e){}
  };

  ws.onclose = function(){
    window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({type:'status',status:'disconnected'}));
  };

  ws.onerror = function(){
    window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({type:'status',status:'error'}));
  };

  term.onData(function(data){
    sendMsg({type:'input',seq:nextSeq(),payload:{data:data}});
  });

  term.onResize(function(size){
    sendMsg({type:'resize',seq:nextSeq(),payload:{cols:size.cols,rows:size.rows}});
  });

  var ro = new ResizeObserver(function(){fitAddon.fit();});
  ro.observe(document.getElementById('terminal'));

  // Listen for messages from React Native (quick keys, input)
  window.addEventListener('message',function(e){
    try{
      var msg=JSON.parse(e.data);
      if(msg.type==='input'){
        sendMsg({type:'input',seq:nextSeq(),payload:{data:msg.data}});
      } else if(msg.type==='detach'){
        sendMsg({type:'detach',seq:nextSeq(),payload:{}});
        ws.close();
      }
    }catch(ex){}
  });
  document.addEventListener('message',function(e){
    try{
      var msg=JSON.parse(e.data);
      if(msg.type==='input'){
        sendMsg({type:'input',seq:nextSeq(),payload:{data:msg.data}});
      } else if(msg.type==='detach'){
        sendMsg({type:'detach',seq:nextSeq(),payload:{}});
        ws.close();
      }
    }catch(ex){}
  });
})();
</script>
</body>
</html>`;
}
