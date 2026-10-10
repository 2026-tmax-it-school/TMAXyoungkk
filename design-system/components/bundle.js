/* @ds-bundle: {"format":4,"namespace":"YoungTrip","components":[{"name":"Icon"},{"name":"Button"},{"name":"IconButton"},{"name":"SearchBar"},{"name":"CategoryTabs"},{"name":"Chip"},{"name":"Badge"},{"name":"TextField"},{"name":"TripCard"},{"name":"ListRow"},{"name":"TabBar"}]} */
(function () {
  var React = window.React;
  var h = React.createElement;

  function cx() {
    var out = [];
    for (var i = 0; i < arguments.length; i++) if (arguments[i]) out.push(arguments[i]);
    return out.join(' ');
  }

  /* 24 viewBox, 선 1.75, round. 앱의 src/ui/Icon.tsx와 같은 그림 */
  var PATHS = {
    search: ['M15.8 15.8 20.5 20.5', { c: [11, 11, 6.6] }],
    heart: ['M12 20.2s-7.8-4.6-7.8-10.3A4.3 4.3 0 0 1 12 7.4a4.3 4.3 0 0 1 7.8 2.5c0 5.7-7.8 10.3-7.8 10.3z'],
    user: ['M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6', { c: [12, 8.2, 3.6] }],
    users: ['M3.4 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5M16.2 5.2a3.4 3.4 0 0 1 0 6.3M17.6 14.9c2 .7 3.4 2.4 3.4 4.6', { c: [9.4, 8.2, 3.4] }],
    map: ['M9.2 4.2 3.5 6.6v13.2l5.7-2.4 5.6 2.4 5.7-2.4V4.2l-5.7 2.4z', 'M9.2 4.2v13.2M14.8 6.6v13.2'],
    cal: ['M3.5 10h17M8 3.2v3.6M16 3.2v3.6', { r: [3.5, 5, 17, 15.5, 2] }],
    chat: ['M20.5 12.6c0 4-3.8 7.2-8.5 7.2a9.9 9.9 0 0 1-2.7-.37L4.2 21l1.2-3.6a6.9 6.9 0 0 1-2.4-5.1c0-4 3.8-7.2 8.5-7.2s9 3.2 9 7.5z'],
    bell: ['M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 2H5z', 'M10 20.5a2 2 0 0 0 4 0'],
    right: ['M9.5 5l7 7-7 7'],
    back: ['M14.5 5 7.5 12l7 7'],
    pin: ['M12 21c4.2-4.6 6.3-8 6.3-10.4A6.3 6.3 0 0 0 5.7 10.6C5.7 13 7.8 16.4 12 21z', { c: [12, 10.4, 2.4] }],
    plus: ['M12 5v14M5 12h14'],
    list: ['M8 6h12M8 12h12M8 18h12M3.6 6h.01M3.6 12h.01M3.6 18h.01'],
    home: ['M3.5 10.2 12 3.5l8.5 6.7V20a.8.8 0 0 1-.8.8h-4.4V14h-6.6v6.8H4.3a.8.8 0 0 1-.8-.8z'],
    clock: ['M12 7.2V12l3.2 2', { c: [12, 12, 8.4] }],
    car: ['M3 16.5v-4l2-5.2a1.4 1.4 0 0 1 1.3-.8h11.4a1.4 1.4 0 0 1 1.3.8l2 5.2v4z', 'M6.4 13h.01M17.6 13h.01M4 16.5v2.3M20 16.5v2.3'],
    walk: ['M11 21l1.7-5.4-2.4-2.6.8-4.3 3.4 1.5 1.1 2.6 2.6.9M10.1 9.3 7.3 11l-.9 3.2M12.7 15.6 8.9 21', { c: [13.2, 4.6, 1.9] }],
    camera: ['M4 8.5A1.5 1.5 0 0 1 5.5 7h2.3l1.6-2.2h5.2L16.2 7h2.3A1.5 1.5 0 0 1 20 8.5V18a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18z', { c: [12, 13, 3.4] }],
    book: ['M4.5 5.5c2.6-1 5.2-1 7.5.8 2.3-1.8 4.9-1.8 7.5-.8v13c-2.6-1-5.2-1-7.5.8-2.3-1.8-4.9-1.8-7.5-.8z', 'M12 6.3v13'],
    gear: ['M12 3v2.8M12 18.2V21M3 12h2.8M18.2 12H21M5.6 5.6l2 2M16.4 16.4l2 2M5.6 18.4l2-2M16.4 7.6l2-2', { c: [12, 12, 2.6] }, { c: [12, 12, 6.2] }],
    check: ['M4.8 12.6 9.6 17.4 19.2 6.6'],
    x: ['M6 6l12 12M18 6 6 18'],
  };

  function Icon(props) {
    var name = props.name, size = props.size || 24, stroke = props.stroke || 1.75;
    var parts = PATHS[name] || [];
    return h('svg', {
      className: cx('yt-icon', props.className), width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
      stroke: 'currentColor', strokeWidth: stroke, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true',
    }, parts.map(function (p, i) {
      if (typeof p === 'string') return h('path', { key: i, d: p });
      if (p.c) return h('circle', { key: i, cx: p.c[0], cy: p.c[1], r: p.c[2] });
      return h('rect', { key: i, x: p.r[0], y: p.r[1], width: p.r[2], height: p.r[3], rx: p.r[4] });
    }));
  }

  function Button(props) {
    var variant = props.variant || 'primary', size = props.size || 'md';
    return h('button', {
      type: props.type || 'button', disabled: props.disabled, onClick: props.onClick,
      className: cx('yt-btn', 'yt-btn-' + variant, 'yt-btn-' + size, props.block && 'yt-btn-block', props.className),
    }, props.icon ? h(Icon, { name: props.icon, size: size === 'sm' ? 16 : 18, stroke: 2 }) : null, props.children);
  }

  function IconButton(props) {
    var variant = props.variant || 'plain';
    return h('button', {
      type: 'button', 'aria-label': props.label, onClick: props.onClick, 'aria-pressed': props.pressed,
      className: cx('yt-iconbtn', 'yt-iconbtn-' + variant, props.pressed && 'is-pressed', props.className),
    }, h(Icon, { name: props.icon, size: props.size || 20, stroke: 2 }));
  }

  function SearchBar(props) {
    return h('button', { type: 'button', className: 'yt-search', onClick: props.onClick },
      h(Icon, { name: 'search', size: 18, stroke: 2.2 }),
      h('span', { className: 'yt-search-text' },
        h('span', { className: 'yt-search-label' }, props.label || '어디로 떠나세요?'),
        props.hint ? h('span', { className: 'yt-search-hint' }, props.hint) : null));
  }

  function CategoryTabs(props) {
    return h('div', { className: 'yt-cats', role: 'tablist' }, props.items.map(function (it) {
      var on = it.key === props.value;
      return h('button', {
        key: it.key, type: 'button', role: 'tab', 'aria-selected': on,
        className: cx('yt-cat', on && 'is-on'),
        onClick: function () { props.onChange && props.onChange(it.key); },
      }, h(Icon, { name: it.icon, size: 24 }), h('span', { className: 'yt-cat-label' }, it.label));
    }));
  }

  function Chip(props) {
    return h('button', {
      type: 'button', 'aria-pressed': !!props.selected, onClick: props.onClick,
      className: cx('yt-chip', props.selected && 'is-on'),
    }, props.icon ? h(Icon, { name: props.icon, size: 16, stroke: 2 }) : null, props.children,
      props.count != null ? h('span', { className: 'yt-chip-count' }, String(props.count)) : null);
  }

  function Badge(props) {
    return h('span', { className: cx('yt-badge', 'yt-badge-' + (props.tone || 'neutral')) }, props.children);
  }

  function TextField(props) {
    var id = props.id || 'yt-field-' + (props.label || '').replace(/\s+/g, '-');
    return h('div', { className: cx('yt-field', props.error && 'is-error') },
      h('label', { className: 'yt-field-box', htmlFor: id },
        h('span', { className: 'yt-field-label' }, props.label),
        h('input', {
          id: id, className: 'yt-field-input', value: props.value, defaultValue: props.defaultValue,
          placeholder: props.placeholder, onChange: props.onChange, 'aria-invalid': !!props.error,
        })),
      props.error ? h('p', { className: 'yt-field-error' }, props.error) : null);
  }

  function TripCard(props) {
    return h('article', { className: cx('yt-card', props.size === 'lg' && 'yt-card-lg') },
      h('div', { className: 'yt-card-media' },
        props.image
          ? h('img', { src: props.image, alt: props.imageAlt || '' })
          : h('div', { className: 'yt-card-ph' }, h(Icon, { name: 'pin', size: 28 }), h('span', null, props.place)),
        props.badge ? h('span', { className: 'yt-card-badge' }, h(Badge, { tone: 'photo' }, props.badge)) : null,
        props.onToggleSave ? h('span', { className: 'yt-card-save' },
          h(IconButton, { icon: 'heart', label: props.saved ? '저장 취소' : '저장', variant: 'photo', pressed: !!props.saved, onClick: props.onToggleSave })) : null),
      h('div', { className: 'yt-card-body' },
        h('h3', { className: 'yt-card-title' }, props.title),
        (props.lines || []).map(function (l, i) { return h('p', { key: i, className: 'yt-card-line' }, l); })),
      props.footer || null);
  }

  function ListRow(props) {
    var inner = [
      props.icon ? h(Icon, { key: 'i', name: props.icon, size: 24, stroke: 1.5 }) : null,
      h('span', { key: 't', className: 'yt-row-text' },
        h('span', { className: 'yt-row-label' }, props.label),
        props.sub ? h('span', { className: 'yt-row-sub' }, props.sub) : null),
      props.trailing ? h('span', { key: 'r', className: 'yt-row-trailing' }, props.trailing) : null,
      props.onClick ? h(Icon, { key: 'c', name: 'right', size: 18, stroke: 2, className: 'yt-row-chev' }) : null,
    ];
    return props.onClick
      ? h('button', { type: 'button', className: 'yt-row', onClick: props.onClick }, inner)
      : h('div', { className: 'yt-row' }, inner);
  }

  function TabBar(props) {
    return h('nav', { className: 'yt-tabbar', 'aria-label': '하단 메뉴' }, props.items.map(function (it) {
      var on = it.key === props.value;
      return h('button', {
        key: it.key, type: 'button', className: cx('yt-tab', on && 'is-on'), 'aria-current': on ? 'page' : undefined,
        onClick: function () { props.onChange && props.onChange(it.key); },
      }, h(Icon, { name: it.icon, size: 24, stroke: on ? 2 : 1.6 }), h('span', null, it.label));
    }));
  }

  window.YoungTrip = Object.assign(window.YoungTrip || {}, {
    Icon: Icon, Button: Button, IconButton: IconButton, SearchBar: SearchBar, CategoryTabs: CategoryTabs,
    Chip: Chip, Badge: Badge, TextField: TextField, TripCard: TripCard, ListRow: ListRow, TabBar: TabBar,
  });
})();
