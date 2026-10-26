import unittest

from hooks.rss_content import full_text_html


URL = "https://example.test/Mon-Blog/notes/article/"


class RSSContentTests(unittest.TestCase):
    def test_preserves_article_structure_code_and_footnotes_without_scripts(self):
        body = ('<h2>Heading</h2><p>Beginning &amp; middle.</p>'
                '<table><tr><th>Column</th><td>Value</td></tr></table>'
                '<ul><li>List item</li></ul><pre><code>&lt;script&gt;code&lt;/script&gt;</code></pre>'
                '<a href="#fn:1">1</a><p id="fn:1">Last footnote.</p>'
                '<script>window.secret = 1;</script><style>p {display:none}</style>'
                '<a href="javascript:alert(1)" onclick="alert(2)">Unsafe link</a>'
                '<img src="//images.example.test/p.png?a=1&amp;b=2" onerror="alert(3)">')
        output = full_text_html(body, URL)
        for fragment in ('<h2>Heading</h2>', '<td>Value</td>', '<li>List item</li>',
                         '&lt;script&gt;code&lt;/script&gt;', 'Last footnote.',
                         'href="' + URL + '#fn:1"', 'src="https://images.example.test/p.png?a=1&amp;b=2"'):
            self.assertIn(fragment, output)
        for fragment in ('<script>', '<style>', 'window.secret', 'javascript:', 'onclick=', 'onerror='):
            self.assertNotIn(fragment, output)

    def test_preserves_math_and_mermaid_source_with_original_link(self):
        body = ('<span class="arithmatex">\\(x^2\\)</span>'
                '<pre class="garden-mermaid"><code>graph TD; A --&gt; B</code></pre>'
                '<details><summary>More</summary><p>Expanded content</p></details>')
        output = full_text_html(body, URL)
        self.assertIn('\\(x^2\\)', output)
        self.assertIn('graph TD; A --&gt; B', output)
        self.assertIn('<details open>', output)
        self.assertIn('查看公式、图表', output)
        self.assertIn('href="' + URL + '"', output)

    def test_missing_rendered_body_fails_instead_of_silently_publishing_an_excerpt(self):
        with self.assertRaises(ValueError):
            full_text_html(None, URL)


if __name__ == "__main__":
    unittest.main()
