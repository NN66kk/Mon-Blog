"""Turn rendered article bodies into self-contained HTML for RSS readers."""
from html import escape
from html.parser import HTMLParser
from urllib.parse import quote, urljoin, urlsplit


ALLOWED_TAGS = set("""
a abbr b blockquote br caption cite code col colgroup dd del details dfn div dl dt
em figcaption figure h1 h2 h3 h4 h5 h6 hr i img input ins kbd li mark ol p pre q
rp rt ruby s samp small span strong sub summary sup table tbody td th thead tfoot
time tr u ul var wbr
""".split())
VOID_TAGS = {"br", "col", "hr", "img", "input", "wbr"}
OMIT_CONTENT = {"script", "style", "iframe", "object", "template"}
ALLOWED_ATTRIBUTES = {
    "id", "class", "title", "alt", "width", "height", "colspan", "rowspan",
    "scope", "start", "reversed", "type", "checked", "disabled", "datetime",
    "lang", "dir", "open", "href", "src",
}


def absolute_url(value, page_url):
    """Resolve against the article, not the feed's directory."""
    value = value.strip()
    if not value:
        return ""
    resolved = urljoin(page_url, value)
    if urlsplit(resolved).scheme.lower() not in {"http", "https", "mailto", "tel"}:
        return ""
    return quote(resolved, safe="/%:@?&=+#,;!$'()*[]~")


class _FeedHTML(HTMLParser):
    def __init__(self, page_url):
        super().__init__(convert_charrefs=True)
        self.page_url = page_url
        self.parts = []
        self.omitted = []
        self.needs_original = False

    def handle_starttag(self, tag, attrs):
        if tag in OMIT_CONTENT:
            self.omitted.append(tag)
            self.needs_original = True
        if self.omitted or tag not in ALLOWED_TAGS:
            return
        attrs = dict(attrs)
        classes = (attrs.get("class") or "").split()
        if "arithmatex" in classes or "garden-mermaid" in classes:
            self.needs_original = True
        # Keep task states readable without the website's checkbox CSS.
        if tag == "input" and attrs.get("type") not in {"checkbox", "radio"}:
            return
        output = []
        for name, value in attrs.items():
            if name not in ALLOWED_ATTRIBUTES:
                continue
            if name in {"href", "src"}:
                value = absolute_url(value or "", self.page_url)
                if not value:
                    continue
            output.append(name if value is None else f'{name}="{escape(value, quote=True)}"')
        if tag == "input" and "disabled" not in attrs:
            output.append("disabled")
        if tag == "details" and "open" not in attrs:
            output.append("open")
        self.parts.append("<" + tag + (" " + " ".join(output) if output else "") + ">")

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in VOID_TAGS:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        if self.omitted:
            if tag == self.omitted[-1]:
                self.omitted.pop()
            return
        if tag in ALLOWED_TAGS and tag not in VOID_TAGS:
            self.parts.append(f"</{tag}>")

    def handle_data(self, data):
        if not self.omitted:
            self.parts.append(escape(data, quote=False))


def full_text_html(body, page_url):
    if not isinstance(body, str):
        raise ValueError(f"RSS article body has not been rendered: {page_url}")
    parser = _FeedHTML(page_url)
    parser.feed(body)
    parser.close()
    label = "阅读原文（查看公式、图表或嵌入内容的完整呈现）" if parser.needs_original else "阅读原文"
    return "".join(parser.parts).strip() + f'<p><a href="{escape(page_url, quote=True)}">{label}</a></p>'
