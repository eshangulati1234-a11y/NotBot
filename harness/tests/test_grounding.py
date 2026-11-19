import json

from notbot_harness.grounding import claims, confirmed, corpus, ground

PAGE = json.dumps(
    {
        "text": 'Run `claude -p "Find the bug" --allowedTools "Read,Edit"` and use /loop 5m check CI. '
        "Resume with --continue or --resume <session-id>.",
        "results": [{"excerpt": "Use claude -p for scripts"}],
    }
)


def test_corpus_flattens_json_so_quotes_match():
    assert 'claude -p "Find the bug"' in corpus([PAGE])


def test_claims_come_from_code_spans_and_fences():
    answer = 'Run `claude -p "x"` then:\n```bash\n$ claude code init\nls -la\n```\nSee `agent.config.ts`.'
    assert claims(answer) == ["claude code init", "ls -la", 'claude -p "x"', "agent.config.ts"]


def test_confirmed_allows_placeholders_but_not_invented_commands():
    text = corpus([PAGE])
    assert confirmed('claude -p "Fix auth" --allowedTools "Read"', text) is True
    assert confirmed("/loop 20m do something", text) is True
    assert confirmed("claude code login", text) is False
    assert confirmed("claude -p x --max-turns 3", text) is False
    assert confirmed("agent.config.ts", text) is None
    assert confirmed("Read", text) is None


def test_ground_adds_a_footer_only_for_unconfirmed_commands():
    good = 'Use `claude -p "hi"`.'
    assert ground(good, [PAGE], opened_page=True) == good
    bad = 'Verified steps: run `claude code login` then `claude -p "hi"`.'
    out = ground(bad, [PAGE], opened_page=False)
    assert "Verified" not in out and "steps:" in out
    assert "Not confirmed in the sources I read: `claude code login`" in out
    assert "search excerpts only" in out
    assert "`claude -p" not in out.split("Not confirmed")[1]


def test_ground_with_opened_page_does_not_claim_excerpt_only():
    out = ground("Run `claude code login`.", [PAGE], opened_page=True)
    assert "Not confirmed" in out and "excerpts only" not in out


def test_ground_leaves_answers_without_sources_alone():
    assert ground("Run `claude code login`.", [], opened_page=False) == "Run `claude code login`."


def test_argument_shape_must_match_how_the_docs_write_the_command():
    docs = corpus(
        [
            json.dumps(
                {"text": "Use /loop 5m check CI, or /loop 20m /review-pr 1234. Bare /loop works."}
            )
        ]
    )
    assert confirmed("/loop 10m watch the build", docs) is True
    assert confirmed('/loop "Check the status of the deployment" 60', docs) is False
    assert confirmed("/loop 60 check", docs) is False
    assert confirmed("/loop [prompt] [interval]", docs) is True
