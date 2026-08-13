// dsh-jina/ui — browser bundle (prebuilt; no build step required).
//
// Executing this script only REGISTERS its factory with the module system
// (`window.__ModuleLoader__.load`). The factory materializes on first import
// and returns a cordis client plugin that registers the "Jina Tools" section
// in the web settings panel. The section edits the `jina-tools` settings
// namespace through the client settings-scope transport, which persists on
// the host through the standard settings service.
window.__ModuleLoader__.load({
  id: 'dsh-jina/ui',
  factory: function (require) {
    var React = require('react')
    var exports = {}
    var NS = 'jina-tools'

    var S = {
      wrap: { display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 560 },
      card: { boxSizing: 'border-box', background: 'var(--dsw-alias-bg-layer-2)', borderRadius: 16, padding: '16px 18px', boxShadow: 'var(--dsw-shadow-lv3)', display: 'flex', flexDirection: 'column', gap: 10 },
      title: { fontSize: 15, fontWeight: 500, color: 'var(--dsw-alias-label-primary)', margin: 0, lineHeight: '22px' },
      text: { fontSize: 13, lineHeight: '20px', color: 'var(--dsw-alias-label-secondary)', margin: 0 },
      row: { display: 'flex', gap: 8, alignItems: 'center' },
      input: { boxSizing: 'border-box', flex: 1, minWidth: 0, height: 36, borderRadius: 10, border: '1px solid rgba(127,127,127,0.35)', background: 'var(--dsw-alias-bg-layer-1, transparent)', color: 'var(--dsw-alias-label-primary)', padding: '0 12px', fontSize: 13, fontFamily: 'inherit', outline: 'none' },
      button: { boxSizing: 'border-box', height: 36, borderRadius: 10, border: 'none', padding: '0 18px', cursor: 'pointer', fontSize: 13, fontWeight: 500, background: 'var(--dsw-alias-interactive-bg-hover)', color: 'var(--dsw-alias-label-primary)', fontFamily: 'inherit' },
      status: { fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-secondary)', margin: 0 },
      statusOk: { fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-status-success, #2f9e44)', margin: 0 },
      link: { color: 'var(--dsw-alias-label-link, var(--dsw-alias-label-primary))', textDecoration: 'underline', cursor: 'pointer' },
    }

    function masked(value) {
      if (value.length > 14) return value.slice(0, 10) + '…' + value.slice(-4)
      return value
    }

    function JinaSettings(props) {
      var scope = props.scope
      var [input, setInput] = React.useState('')
      var [status, setStatus] = React.useState('')
      var [ok, setOk] = React.useState(false)
      var [tick, setTick] = React.useState(0)

      React.useEffect(function () {
        if (!scope) return
        var dispose = scope.subscribe(function () { setTick(function (t) { return t + 1 }) })
        void scope.load()
        return dispose
      }, [scope])

      var snap = scope ? scope.getSnapshot() : undefined
      var snapshotStatus = snap ? snap.status : 'unavailable'
      var value = (snap && snap.value && typeof snap.value.apiKey === 'string') ? snap.value.apiKey : ''
      var writable = !!(snap && snap.writable)

      function onInput(e) { setInput(e.target.value) }

      function onSave() {
        if (!scope || !writable) return
        if (input.trim() === '') {
          setStatus('请输入 API key（或在对应 key 文件里配置）。')
          return
        }
        setOk(false)
        setStatus('保存中…')
        scope.set('apiKey', input.trim()).then(
          function () { setOk(true); setStatus('已保存。'); setInput('') },
          function () { setOk(false); setStatus('保存失败，请重试。') },
        )
      }

      var shown = snapshotStatus === 'ready' && value !== ''
        ? '当前已保存的 key：' + masked(value)
        : snapshotStatus === 'loading'
          ? '正在读取设置…'
          : '尚未保存 API key。'

      return React.createElement('div', { style: S.wrap },
        React.createElement('div', { style: S.card },
          React.createElement('p', { style: S.title }, 'Jina AI API Key'),
          React.createElement('p', { style: S.text }, 'jina_search / jina_read 等工具会优先使用这里保存的 key。免费 key 可在 ', React.createElement('a', { style: S.link, href: 'https://jina.ai/?sui=apikey', target: '_blank', rel: 'noreferrer' }, 'jina.ai'), ' 获取。'),
          snapshotStatus === 'unavailable'
            ? React.createElement('p', { style: S.status }, '设置存储当前不可用：可在会话工作区或 dsh 主目录放置 jina-api-key.txt 作为回退。')
            : null,
          React.createElement('div', { style: S.row },
            React.createElement('input', {
              style: S.input,
              type: 'password',
              value: input,
              placeholder: '粘贴 API key…',
              onChange: onInput,
              autoComplete: 'off',
              spellCheck: false,
              disabled: !writable && snapshotStatus !== 'loading',
            }),
            React.createElement('button', {
              style: S.button,
              onClick: onSave,
              disabled: !writable,
            }, '保存'),
          ),
          status !== '' ? React.createElement('p', { style: ok ? S.statusOk : S.status }, status) : null,
          React.createElement('p', { style: S.status }, shown),
          writable ? null : React.createElement('p', { style: S.status }, '当前连接只读（设置 RPC 仅在本机回环地址可用）。'),
        ),
        React.createElement('div', { style: S.card },
          React.createElement('p', { style: S.title }, 'key 的解析顺序'),
          React.createElement('p', { style: S.text }, '1. 工具调用参数 apiKey；2. 本页保存的 key（settings 命名空间 jina-tools，持久化于 dsh 主目录）；3. 会话工作区的 jina-api-key.txt；4. dsh 主目录下的 jina-api-key.txt。'),
          React.createElement('p', { style: S.text }, '中国大陆网络环境下调用 Jina 需要 VPN；插件会自动发现并跟随系统代理（含代理端口变化）。'),
        ),
      )
    }

    exports.name = 'dsh-jina-ui'
    exports.inject = ['slots', 'settingsScope', 'connection', 'remote']

    exports.apply = function (ctx) {
      var slots = ctx.get('slots')
      if (slots === undefined) return
      var scope = ctx.settingsScope.bind({ namespace: NS })
      slots.inject('settings.section', function () {
        return slots.register(
          { name: 'settings.section', id: 'jina-tools', order: 30, label: 'Jina Tools' },
          function (props) {
            return React.createElement(JinaSettings, { scope: scope, close: props.close })
          },
        )
      })
    }

    return exports
  },
})
