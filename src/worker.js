import html from './index.html'

const wsInit = () => {
  const [client, server] = Object.values(new WebSocketPair())
  server.accept()
  return { client, server }
}

const asyncWS = {
  open: (ws, { timeout = 3000, interval = 100 }) => new Promise(async (resolve, reject) => {
    const check = setInterval(() => {
      if (ws.readyState === ws.OPEN) { clearInterval(check); resolve(ws) };
    }, interval);
    setTimeout(() => { clearInterval(check); reject('WebSocket: timeout') }, timeout);
  })
}

const getLiveData = url => fetch(url)
  .then(r => r.text())
  .then(r => r.match(/<script id="embedded-data" data-props="(.*?)">/)[1])
  .then(r => JSON.parse(r.replaceAll('&quot;', '"')))

const connectCommentServer = (id, url) => {
  const ws = new WebSocket(url)

  ws.addEventListener('open', (e) => {
    ws.send(JSON.stringify([
      { ping: { content: 'rs:0' } }, { ping: { content: 'ps:0' } },
      {
        thread: {
          thread: id,
          version: '20061206',
          res_from: 0, // 負数分遡ってコメント取得
          with_global: 1,
          scores: 1,
          nicoru: 0,
          user_id: 'guest',
          // threadkey: '',
        }
      },
      { ping: { content: 'pf:0' } }, { ping: { content: 'rf:0' } }
    ]))
  })

  ws.addEventListener('close', () => {
    globalThis.ws.server.close()
  })

  ws.addEventListener('message', ({ data }) => {
    const z = JSON.parse(data)
    if (z.data?.reason) globalThis.ws.server.close()
    if (z.chat) globalThis.ws.server.send(data)
  })
}

export default {
  async fetch (req, env, ctx) {
    const requestUrl = new URL(req.url)
    if (requestUrl.pathname !== '/ws') {
      return new Response(html, {
        headers: { 'Content-Type': 'text/html; charset=UTF-8' }
      })
    }

    // WebSocket Pair
    globalThis.ws = wsInit()
    
    // Validate Request URL
    const url = requestUrl.searchParams.get('url')
    try { new URL(url) } catch { throw new Error(`Invalid request url "${url}"`) }

    // Get NicoLive Program Data
    const live = await getLiveData(url);
    if (live.program.status === 'ENDED') throw new Error('This program is ended')
    if (live.program.isFollowerOnly) throw new Error('This program is follower only')
    if (live.program.isPrivate) throw new Error('This program is private')

    // Connect NicoLive Program WebSocket Server
    const ws = new WebSocket(live.site.relive.webSocketUrl)
    ws.addEventListener('open', (e) => {
      ws.send(JSON.stringify({
        type: 'startWatching',
        data: {
          stream: {
            quality: 'normal',
            protocol: 'hls',
            latency: 'high',
            chasePlay: false
          },
          room: {
            protocol: 'webSocket',
            commentable: true
          },
          reconnect: true
        }
      }))
    })

    ws.addEventListener('close', () => {
      globalThis.ws.server.close()
    })

    ws.addEventListener('message', ({ data }) => {
      const z = JSON.parse(data)
      if (z.type === 'ping') {
        ws.send('{"type":"pong"}')
      }
      if (z.type === 'seat') {
        setInterval(() => ws.send('{"type":"keepSeat"}'), z.data.keepIntervalSec * 1000)
      }
      if (z.type === 'room') {
        connectCommentServer(z.data.threadId, z.data.messageServer.uri)
      }
    })

    return new Response(null, { status: 101, webSocket: globalThis.ws.client });
  }
}