// dsh-jina/ui — browser bundle (prebuilt; no build step required).
//
// Executing this script only REGISTERS its factory with the module system
// (`window.__ModuleLoader__.load`). The factory materializes on first import
// and returns a cordis client plugin that registers the "Jina Tools" section
// in the web settings panel. The section manages the `JINA_API_KEY`
// credential through the standard credentials RPC domain: values cross the
// wire only on save (credentials.set), and the page shows configured state,
// never the stored value.
window.__ModuleLoader__.load({
  id: 'dsh-jina/ui',
  factory: function (require) {
    var React = require('react')
    var exports = {}
    var CRED = 'JINA_API_KEY'

    var S = {
      wrap: { display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 560 },
      card: { boxSizing: 'border-box', background: 'var(--dsw-alias-bg-layer-2)', borderRadius: 16, padding: '16px 18px', boxShadow: 'var(--dsw-shadow-lv3)', display: 'flex', flexDirection: 'column', gap: 10 },
      title: { fontSize: 15, fontWeight: 500, color: 'var(--dsw-alias-label-primary)', margin: 0, lineHeight: '22px' },
      text: { fontSize: 13, lineHeight: '20px', color: 'var(--dsw-alias-label-secondary, rgba(127,127,127,0.92))', margin: 0 },
      row: { display: 'flex', gap: 8, alignItems: 'center' },
      input: { boxSizing: 'border-box', flex: 1, minWidth: 0, height: 36, borderRadius: 10, border: '1px solid rgba(127,127,127,0.35)', background: 'var(--dsw-alias-bg-layer-1, transparent)', color: 'var(--dsw-alias-label-primary)', padding: '0 12px', fontSize: 13, fontFamily: 'inherit', outline: 'none' },
      button: { boxSizing: 'border-box', height: 36, borderRadius: 10, border: 'none', padding: '0 18px', cursor: 'pointer', fontSize: 13, fontWeight: 500, background: 'var(--dsw-alias-interactive-bg-hover)', color: 'var(--dsw-alias-label-primary)', fontFamily: 'inherit' },
      ghostButton: { boxSizing: 'border-box', height: 36, borderRadius: 10, border: '1px solid rgba(127,127,127,0.35)', padding: '0 18px', cursor: 'pointer', fontSize: 13, fontWeight: 500, background: 'transparent', color: 'var(--dsw-alias-label-secondary, rgba(127,127,127,0.92))', fontFamily: 'inherit' },
      status: { fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-secondary, rgba(127,127,127,0.92))', margin: 0 },
      statusOk: { fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-status-success, #2f9e44)', margin: 0 },
      link: { color: 'var(--dsw-alias-label-link, var(--dsw-alias-label-primary))', textDecoration: 'underline', cursor: 'pointer' },
    }

    function JinaSettings(props) {
      var api = props.api
      var remote = props.remote
      var [input, setInput] = React.useState('')
      var [status, setStatus] = React.useState('')
      var [ok, setOk] = React.useState(false)
      var [view, setView] = React.useState(undefined) // {configured, writable} | undefined while loading

      var refresh = function () {
        api.credentials.describe({ refs: [CRED] }).then(function (response) {
          if (!response.result.ok) return
          setView(response.result.value.credentials[CRED])
        }, function () { /* keep previous view */ })
      }

      React.useEffect(function () {
        refresh()
        var dispose = remote.$on('credentials/updated', function (ref) {
          if (ref === CRED) refresh()
        })
        return dispose
      }, [api, remote])

      function onInput(e) { setInput(e.target.value) }

      function onSave() {
        if (input.trim() === '') {
          setOk(false)
          setStatus('请输入 API key。')
          return
        }
        setOk(false)
        setStatus('保存中…')
        api.credentials.set({ ref: CRED, value: input.trim() }).then(function (response) {
          if (response.result.ok) {
            setOk(true)
            setStatus('已保存。')
            setInput('')
            refresh()
          } else {
            setOk(false)
            setStatus('保存失败：' + String((response.result.error && response.result.error.message) || '未知错误'))
          }
        }, function () {
          setOk(false)
          setStatus('保存失败，请重试。')
        })
      }

      function onClear() {
        setOk(false)
        setStatus('清除中…')
        api.credentials.unset({ ref: CRED }).then(function (response) {
          if (response.result.ok) {
            setOk(true)
            setStatus('已清除。')
            refresh()
          } else {
            setOk(false)
            setStatus('清除失败：' + String((response.result.error && response.result.error.message) || '未知错误'))
          }
        }, function () {
          setOk(false)
          setStatus('清除失败，请重试。')
        })
      }

      var configured = view ? view.configured === true : false
      var writable = view ? view.writable === true : false
      var shown = view === undefined
        ? '正在读取设置…'
        : configured
          ? 'API key 已保存（来源：' + String(view.source || '本机存储') + '）。粘贴新 key 并保存即可覆盖。'
          : '尚未保存 API key。'

      return React.createElement('div', { style: S.wrap },
        React.createElement('div', { style: S.card },
          React.createElement('p', { style: S.title }, 'Jina AI API Key'),
          React.createElement('p', { style: S.text }, 'jina_search / jina_read 等工具会优先使用这里保存的 key。免费 key 可在 ', React.createElement('a', { style: S.link, href: 'https://jina.ai/?sui=apikey', target: '_blank', rel: 'noreferrer' }, 'jina.ai'), ' 获取。'),
          React.createElement('div', { style: S.row },
            React.createElement('input', {
              style: S.input,
              type: 'password',
              value: input,
              placeholder: '粘贴 API key…',
              onChange: onInput,
              autoComplete: 'off',
              spellCheck: false,
              disabled: view !== undefined && !writable,
            }),
            React.createElement('button', {
              style: S.button,
              onClick: onSave,
              disabled: view !== undefined && !writable,
            }, '保存'),
            configured
              ? React.createElement('button', { style: S.ghostButton, onClick: onClear, disabled: !writable }, '清除')
              : null,
          ),
          status !== '' ? React.createElement('p', { style: ok ? S.statusOk : S.status }, status) : null,
          React.createElement('p', { style: S.status }, shown),
          view !== undefined && !writable ? React.createElement('p', { style: S.status }, '当前环境只读：key 由环境变量等来源提供，无法在此修改。') : null,
        ),
        React.createElement('div', { style: S.card },
          React.createElement('p', { style: S.title }, 'key 的解析顺序'),
          React.createElement('p', { style: S.text }, '1. 工具调用参数 apiKey；2. 本页保存的 key（credential 引用 ' + CRED + '，由 dsh 凭据存储持久化）；3. 会话工作区的 jina-api-key.txt；4. dsh 主目录下的 jina-api-key.txt。'),
          React.createElement('p', { style: S.text }, '保存后立即生效，无需重启。中国大陆网络环境下调用 Jina 需要 VPN；插件会自动发现并跟随系统代理（含代理端口变化）。'),
        ),
      )
    }

    exports.name = 'dsh-jina-ui'
    exports.inject = ['slots', 'connection', 'remote']

    exports.apply = function (ctx) {
      var slots = ctx.get('slots')
      if (slots === undefined) return
      var connection = ctx.get('connection')
      var api = connection ? connection.api : undefined
      var remote = ctx.get('remote')
      if (api === undefined || remote === undefined) return
      slots.inject('settings.section', function () {
        return slots.register(
          { name: 'settings.section', id: 'jina-tools', order: 30, label: 'Jina Tools' },
          function (props) {
            return React.createElement(JinaSettings, { api: api, remote: remote, close: props.close })
          },
        )
      })
    }

    return exports
  },
})
