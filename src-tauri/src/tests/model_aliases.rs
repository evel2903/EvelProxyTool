use super::support::*;
use super::*;

#[test]
fn thinking_alias_adds_fork_and_matching_payload_rule() {
    let input = "# Keep this comment\ndebug: true\npayload:\n  override:\n    - models:\n        - name: existing-fast\n          protocol: codex\n      params:\n        service_tier: priority\n";
    let source = test_codex_oauth_thinking_source("gpt-5.5");
    let rendered =
        add_model_alias_to_yaml(input, &source, "gpt-5.5-xhigh", "xhigh", false).unwrap();
    let aliases = thinking_aliases_from_yaml(&rendered).unwrap();

    assert!(rendered.contains("# Keep this comment"), "{rendered}");
    assert!(rendered.contains("service_tier: priority"), "{rendered}");
    assert_eq!(
        aliases,
        vec![ThinkingAliasEntry {
            source_model: "gpt-5.5".to_string(),
            alias: "gpt-5.5-xhigh".to_string(),
            effort: Some("xhigh".to_string()),
            provider: "Codex OAuth".to_string(),
            kind: "codex-oauth".to_string(),
        }]
    );
}

#[test]
fn model_alias_can_be_created_without_overrides() {
    let source = test_codex_oauth_thinking_source("gpt-5.5");
    let rendered = add_model_alias_to_yaml("{}\n", &source, "gpt-5.5-alias", "", false).unwrap();

    assert!(rendered.contains("alias: gpt-5.5-alias"), "{rendered}");
    assert!(!rendered.contains("payload:"), "{rendered}");
    assert_eq!(
        thinking_aliases_from_yaml(&rendered).unwrap(),
        vec![ThinkingAliasEntry {
            source_model: "gpt-5.5".to_string(),
            alias: "gpt-5.5-alias".to_string(),
            effort: None,
            provider: "Codex OAuth".to_string(),
            kind: "codex-oauth".to_string(),
        }]
    );
}

#[test]
fn configured_model_alias_can_be_created_without_overrides() {
    let input = "codex-api-key:\n  - api-key: test\n    base-url: https://example.com/v1\n    models:\n      - name: gpt-custom\n";
    let available_models = test_agent_models(&["gpt-custom"]);
    let sources = resolved_alias_sources(input, &[], &available_models, false).unwrap();
    let source = sources
        .iter()
        .find(|source| source.source.model == "gpt-custom")
        .unwrap();
    let rendered = add_model_alias_to_yaml(input, source, "gpt-custom-alias", "", false).unwrap();

    assert!(rendered.contains("alias: gpt-custom-alias"), "{rendered}");
    assert!(!rendered.contains("thinking:"), "{rendered}");
    assert!(!rendered.contains("payload:"), "{rendered}");
    let entries = thinking_aliases_from_yaml(&rendered).unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].effort, None);
}

#[test]
fn model_alias_can_apply_reasoning_and_fast_together() {
    let source = test_codex_oauth_thinking_source("gpt-5.6-sol");
    let rendered =
        add_model_alias_to_yaml("{}\n", &source, "gpt-5.6-sol-xhigh-fast", "xhigh", true).unwrap();

    assert!(rendered.contains("reasoning.effort: xhigh"), "{rendered}");
    assert!(rendered.contains("service_tier: priority"), "{rendered}");
    assert_eq!(thinking_aliases_from_yaml(&rendered).unwrap().len(), 1);
    assert_eq!(speed_aliases_from_yaml(&rendered).unwrap().len(), 1);

    let restored = remove_thinking_alias_from_yaml(&rendered, "gpt-5.6-sol-xhigh-fast").unwrap();
    assert!(!restored.contains("gpt-5.6-sol-xhigh-fast"), "{restored}");
    assert!(!restored.contains("service_tier: priority"), "{restored}");

    let legacy = "oauth-model-alias:\n  codex:\n    - name: gpt-5.6-sol\n      alias: legacy-combined\n      fork: true\npayload:\n  override:\n    - models:\n        - name: legacy-combined\n          protocol: codex\n      params:\n        reasoning.effort: high\n    - models:\n        - name: legacy-combined\n          protocol: codex\n      params:\n        service_tier: priority\n";
    let restored = remove_thinking_alias_from_yaml(legacy, "legacy-combined").unwrap();
    assert!(!restored.contains("legacy-combined"), "{restored}");
    assert!(!restored.contains("service_tier: priority"), "{restored}");
}

#[test]
fn speed_alias_adds_fast_service_tier_and_removes_only_its_rule() {
    let input = "payload:\n  override:\n    - models:\n        - name: existing-thinker\n          protocol: codex\n      params:\n        reasoning.effort: xhigh\n";
    let source = test_codex_oauth_thinking_source("gpt-5.6-sol");
    let rendered = add_speed_alias_to_yaml(input, &source, "gpt-5.6-sol-fast").unwrap();

    assert!(rendered.contains("alias: gpt-5.6-sol-fast"), "{rendered}");
    assert!(rendered.contains("service_tier: priority"), "{rendered}");
    assert!(!rendered.contains("reasoning.effort: fast"), "{rendered}");
    assert_eq!(
        speed_aliases_from_yaml(&rendered).unwrap(),
        vec![SpeedAliasEntry {
            source_model: "gpt-5.6-sol".to_string(),
            alias: "gpt-5.6-sol-fast".to_string(),
            service_tier: "priority".to_string(),
            provider: "Codex OAuth".to_string(),
            kind: "codex-oauth".to_string(),
        }]
    );

    let restored = remove_speed_alias_from_yaml(&rendered, "gpt-5.6-sol-fast").unwrap();
    assert!(!restored.contains("gpt-5.6-sol-fast"), "{restored}");
    assert!(restored.contains("reasoning.effort: xhigh"), "{restored}");
}

#[test]
fn speed_alias_supports_openai_compatible_model_entries() {
    let input = "openai-compatibility:\n  - name: Relay\n    base-url: https://example.com/v1\n    api-key-entries:\n      - api-key: test\n    models:\n      - name: gpt-5.6-terra\n        display-name: Terra\n";
    let available_models = test_agent_models(&["gpt-5.6-terra"]);
    let sources = resolved_thinking_alias_sources(input, &[], &available_models).unwrap();
    let source = sources
        .iter()
        .find(|source| source.source.model == "gpt-5.6-terra")
        .unwrap();
    let rendered = add_speed_alias_to_yaml(input, source, "gpt-5.6-terra-fast").unwrap();

    assert!(rendered.contains("alias: gpt-5.6-terra-fast"), "{rendered}");
    assert!(
        rendered.contains("display-name: Terra (Fast)"),
        "{rendered}"
    );
    assert!(rendered.contains("protocol: openai"), "{rendered}");
    assert!(rendered.contains("service_tier: priority"), "{rendered}");
    assert_eq!(speed_aliases_from_yaml(&rendered).unwrap().len(), 1);

    let restored = remove_speed_alias_from_yaml(&rendered, "gpt-5.6-terra-fast").unwrap();
    assert!(!restored.contains("gpt-5.6-terra-fast"), "{restored}");
}

#[test]
fn speed_alias_sources_include_codex_models_without_reasoning_levels() {
    let definitions = vec![CodexModelDefinition {
        id: "gpt-speed-only".to_string(),
        display_name: None,
        description: None,
        context_window: None,
        reasoning_levels: Vec::new(),
        supports_tools: None,
    }];
    let available_models = test_agent_models(&["gpt-speed-only"]);

    assert!(
        resolved_thinking_alias_sources("{}", &definitions, &available_models)
            .unwrap()
            .is_empty()
    );
    let sources = resolved_speed_alias_sources("{}", &definitions, &available_models).unwrap();
    assert_eq!(sources.len(), 1);
    assert_eq!(sources[0].source.model, "gpt-speed-only");
}

#[test]
fn thinking_alias_effort_accepts_provider_defined_levels() {
    assert_eq!(validate_thinking_alias_effort(" AUTO ").unwrap(), "auto");
    assert_eq!(validate_thinking_alias_effort("ultra").unwrap(), "ultra");
    assert_eq!(
        validate_thinking_alias_effort("vendor_level-2.1").unwrap(),
        "vendor_level-2.1"
    );
    assert!(validate_thinking_alias_effort("").is_err());
    assert!(validate_thinking_alias_effort("high value").is_err());
    assert!(validate_thinking_alias_effort("32768").is_err());
}

#[test]
fn thinking_alias_removal_keeps_other_models_in_grouped_rule() {
    let input = "oauth-model-alias:\n  codex:\n    - name: gpt-5.5\n      alias: gpt-5.5-xhigh\n      fork: true\n    - name: gpt-5.4\n      alias: gpt-5.4-xhigh\n      fork: true\npayload:\n  override:\n    - models:\n        - name: gpt-5.5-xhigh\n          protocol: codex\n        - name: gpt-5.4-xhigh\n          protocol: codex\n      params:\n        reasoning.effort: xhigh\n";
    let rendered = remove_thinking_alias_from_yaml(input, "gpt-5.5-xhigh").unwrap();
    let aliases = thinking_aliases_from_yaml(&rendered).unwrap();

    assert_eq!(aliases.len(), 1);
    assert_eq!(aliases[0].alias, "gpt-5.4-xhigh");
    assert!(!rendered.contains("gpt-5.5-xhigh"), "{rendered}");
    assert!(rendered.contains("gpt-5.4-xhigh"), "{rendered}");
    assert!(rendered.contains("reasoning.effort: xhigh"), "{rendered}");
}

#[test]
fn thinking_alias_rejects_duplicate_client_visible_name() {
    let input = "oauth-model-alias:\n  codex:\n    - name: gpt-5.5\n      alias: gpt-5.5-high\n      fork: true\n";
    let source = test_codex_oauth_thinking_source("gpt-5.4");
    assert!(
        add_model_alias_to_yaml(input, &source, "GPT-5.5-HIGH", "high", false)
            .unwrap_err()
            .contains("already exists")
    );
}

#[test]
fn thinking_alias_supports_openai_compatible_model_entries() {
    let input = "openai-compatibility:\n  - name: DeepSeek\n    base-url: https://api.deepseek.com\n    api-key-entries:\n      - api-key: test\n    models:\n      - name: deepseek-chat\n        display-name: DeepSeek Chat\n        thinking:\n          levels: [low, medium, high]\n";
    let available_models = test_agent_models(&["deepseek-chat"]);
    let sources = resolved_thinking_alias_sources(input, &[], &available_models).unwrap();
    let source = sources
        .iter()
        .find(|source| source.source.model == "deepseek-chat")
        .unwrap();
    let rendered =
        add_model_alias_to_yaml(input, source, "deepseek-chat-high", "high", false).unwrap();
    let value: serde_norway::Value = serde_norway::from_str(&rendered).unwrap();
    let root = value.as_mapping().unwrap();
    let providers = yaml_mapping_value(root, "openai-compatibility")
        .and_then(serde_norway::Value::as_sequence)
        .unwrap();
    let models = yaml_mapping_value(providers[0].as_mapping().unwrap(), "models")
        .and_then(serde_norway::Value::as_sequence)
        .unwrap();
    let alias_model = models[1].as_mapping().unwrap();

    assert_eq!(models.len(), 2);
    assert_eq!(
        yaml_mapping_value(alias_model, "name").and_then(serde_norway::Value::as_str),
        Some("deepseek-chat")
    );
    assert_eq!(
        yaml_mapping_value(alias_model, "alias").and_then(serde_norway::Value::as_str),
        Some("deepseek-chat-high")
    );
    assert!(rendered.contains("protocol: openai"), "{rendered}");
    assert!(rendered.contains("reasoning_effort: high"), "{rendered}");
    assert!(rendered.contains("thinking.type: enabled"), "{rendered}");
    assert!(!rendered.contains("oauth-model-alias"), "{rendered}");

    let entries = thinking_aliases_from_yaml(&rendered).unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].provider, "DeepSeek");
    assert_eq!(entries[0].kind, "openai-compatible");

    let restored = remove_thinking_alias_from_yaml(&rendered, "deepseek-chat-high").unwrap();
    assert!(!restored.contains("deepseek-chat-high"), "{restored}");
    assert!(!restored.contains("reasoning_effort"), "{restored}");
}

#[test]
fn thinking_alias_supports_codex_api_model_entries() {
    let input = "codex-api-key:\n  - api-key: test\n    base-url: https://example.com/v1\n    models:\n      - name: gpt-custom\n";
    let available_models = test_agent_models(&["gpt-custom"]);
    let sources = resolved_thinking_alias_sources(input, &[], &available_models).unwrap();
    let source = sources
        .iter()
        .find(|source| source.source.kind == "codex-api")
        .unwrap();
    let rendered =
        add_model_alias_to_yaml(input, source, "gpt-custom-xhigh", "xhigh", false).unwrap();

    assert!(rendered.contains("alias: gpt-custom-xhigh"), "{rendered}");
    assert!(rendered.contains("protocol: codex"), "{rendered}");
    assert!(rendered.contains("reasoning.effort: xhigh"), "{rendered}");
    assert!(!rendered.contains("oauth-model-alias"), "{rendered}");
    let entries = thinking_aliases_from_yaml(&rendered).unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].kind, "codex-api");
}
