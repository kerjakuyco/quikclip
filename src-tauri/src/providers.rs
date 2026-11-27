//! Native provider clients. Only non-secret connection details cross back to the UI.
use crate::media::Result;
use base64::{engine::general_purpose::STANDARD, Engine};
use reqwest::{Client, RequestBuilder};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;

#[derive(Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Ollama,
    LmStudio,
    OpenRouter,
    Cloudflare,
    /// A Whisper server on this computer that speaks OpenAI's transcription API: whisper.cpp's server, Speaches, or
    /// faster-whisper-server. Speech to text with nothing leaving the machine.
    Whisper,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Connection {
    pub provider: Provider,
    pub port: Option<u16>,
    pub account_id: Option<String>,
    pub gateway: Option<String>,
    /// The speech model a local Whisper server should use, when it serves more than one.
    #[serde(default)]
    pub model: Option<String>,
}

impl Connection {
    fn port(&self) -> u16 {
        self.port.unwrap_or(match self.provider {
            Provider::Ollama => 11434,
            Provider::Whisper => 8000,
            _ => 1234,
        })
    }
    fn gateway(&self) -> &str {
        self.gateway
            .as_deref()
            .filter(|x| !x.is_empty())
            .unwrap_or("default")
    }
    fn cloud(&self) -> bool {
        matches!(self.provider, Provider::Cloudflare | Provider::OpenRouter)
    }
    pub fn label(&self) -> &'static str {
        match self.provider {
            Provider::Ollama => "Ollama",
            Provider::LmStudio => "LM Studio",
            Provider::OpenRouter => "OpenRouter",
            Provider::Cloudflare => "Cloudflare AI Gateway",
            Provider::Whisper => "Whisper server",
        }
    }
    fn base(&self) -> Result<String> {
        match self.provider {
            Provider::Ollama | Provider::LmStudio | Provider::Whisper if self.port() == 0 => {
                Err("Enter a port between 1 and 65535.".into())
            }
            Provider::Ollama | Provider::LmStudio | Provider::Whisper => {
                Ok(format!("http://127.0.0.1:{}", self.port()))
            }
            Provider::OpenRouter => Ok("https://openrouter.ai/api/v1".into()),
            Provider::Cloudflare => {
                let id = self.account_id.as_deref().unwrap_or("");
                if id.len() != 32 || !id.bytes().all(|c| c.is_ascii_hexdigit()) {
                    return Err("Enter your 32-character Cloudflare account ID.".into());
                }
                let g = self.gateway();
                if g.len() > 64
                    || !g
                        .bytes()
                        .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
                {
                    return Err("Enter a gateway ID, such as default, rather than a URL.".into());
                }
                Ok(format!(
                    "https://api.cloudflare.com/client/v4/accounts/{id}/ai"
                ))
            }
        }
    }
    fn credential_id(&self) -> Option<String> {
        match self.provider {
            Provider::Ollama | Provider::Whisper => None,
            Provider::OpenRouter => Some("openrouter".into()),
            Provider::LmStudio => Some(format!("lmstudio-{}", self.port())),
            Provider::Cloudflare => Some(format!(
                "cloudflare-{}",
                self.account_id.as_deref().unwrap_or("")
            )),
        }
    }
}

enum Secret {
    Read,
    Save(String),
    Delete,
}
async fn credential(c: &Connection, op: Secret) -> Result<Option<String>> {
    let Some(id) = c.credential_id() else {
        return Ok(None);
    };
    tauri::async_runtime::spawn_blocking(move || {
        let entry = keyring::Entry::new("studio.quikclip.providers", &id)?;
        let result = match op {
            Secret::Read => entry.get_password().map(Some),
            Secret::Save(key) => entry.set_password(&key).map(|_|None),
            Secret::Delete => entry.delete_credential().map(|_|None),
        };
        match result { Err(keyring::Error::NoEntry)=>Ok(None), result=>result }
    }).await.map_err(|_|"Credential store unavailable.".to_owned())?
        .map_err(|_|"Unlock your system credential store and try again. On Linux, enable a Secret Service keyring.".to_owned())
}

#[derive(Serialize)]
pub struct Model {
    id: String,
    name: String,
}
impl Model {
    fn from(id: Option<&str>, name: Option<&str>) -> Option<Self> {
        let id = id.filter(|id| !id.is_empty())?;
        Some(Self {
            id: id.to_owned(),
            name: name.unwrap_or(id).to_owned(),
        })
    }
}

#[derive(Clone)]
pub struct Session {
    config: Connection,
    client: Client,
    base: String,
    token: Option<String>,
}
impl Session {
    pub async fn new(config: Connection, entered: Option<&str>) -> Result<Self> {
        let base = config.base()?;
        let token = match entered.map(str::trim).filter(|s| !s.is_empty()) {
            Some(key) if key.len() <= 8192 && key.bytes().all(|c| c.is_ascii_graphic()) => {
                Some(key.to_owned())
            }
            Some(_) => return Err("The token contains invalid characters.".into()),
            None => {
                let saved = credential(&config, Secret::Read).await;
                if config.provider == Provider::LmStudio {
                    saved.unwrap_or(None)
                } else {
                    saved?
                }
            }
        };
        if config.cloud() && token.is_none() {
            return Err(format!(
                "Enter your {} API token to connect.",
                config.label()
            ));
        }
        let builder = Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(8))
            .timeout(Duration::from_secs(300));
        let client = if config.cloud() {
            builder
        } else {
            builder.no_proxy()
        }
        .build()
        .map_err(|_| "Could not initialize provider connection.")?;
        Ok(Self {
            config,
            client,
            base,
            token,
        })
    }
    /// A session aimed at a local stand-in for the provider.
    #[cfg(test)]
    pub fn with_base(mut self, base: String) -> Self {
        self.base = base;
        self
    }
    fn req(&self, method: reqwest::Method, suffix: &str) -> RequestBuilder {
        let mut r = self
            .client
            .request(method, format!("{}{suffix}", self.base));
        if let Some(token) = &self.token {
            r = r.bearer_auth(token);
        }
        if self.config.provider == Provider::Cloudflare {
            r = r.header("cf-aig-gateway-id", self.config.gateway());
        }
        r
    }
    async fn json(&self, r: RequestBuilder) -> Result<Value> {
        let name = self.config.label();
        let res = r.send().await.map_err(|e| {
            if e.is_timeout() {
                format!("{name} timed out. Check the server or try a smaller model.")
            } else if self.config.cloud() {
                format!("Could not reach {name}. Check your network connection.")
            } else {
                format!(
                    "Start the {name} local server and check port {}.",
                    self.config.port()
                )
            }
        })?;
        if !res.status().is_success() {
            let code = res.status().as_u16();
            let body = res.text().await.unwrap_or_default();
            return Err(format!(
                "{name} returned {code}. {}",
                provider_failure(code, &body)
            ));
        }
        res.json()
            .await
            .map_err(|_| format!("{name} returned an unreadable response."))
    }
    async fn get(&self, suffix: &str) -> Result<Value> {
        self.json(
            self.req(reqwest::Method::GET, suffix)
                .timeout(Duration::from_secs(15)),
        )
        .await
    }
    async fn ollama_vision(&self, id: &str) -> Result<bool> {
        if id.ends_with(":cloud") || id.ends_with("-cloud") {
            return Ok(false);
        }
        let v = self
            .json(
                self.req(reqwest::Method::POST, "/api/show")
                    .timeout(Duration::from_secs(15))
                    .json(&json!({"model":id})),
            )
            .await?;
        Ok(v["remote_model"].as_str().unwrap_or("").is_empty()
            && v["remote_host"].as_str().unwrap_or("").is_empty()
            && contains(&v["capabilities"], "vision"))
    }
    async fn models(&self) -> Result<Vec<Model>> {
        let mut models = match self.config.provider {
            // A Whisper server hears; it has no vision models to list.
            Provider::Whisper => Vec::new(),
            Provider::Ollama => {
                let response = self.get("/api/tags").await?;
                let mut out = Vec::new();
                for v in response["models"]
                    .as_array()
                    .ok_or("Unexpected Ollama model list.")?
                {
                    if let Some(id) = v["name"].as_str() {
                        if self.ollama_vision(id).await? {
                            out.push(Model::from(Some(id), None).unwrap());
                        }
                    }
                }
                out
            }
            Provider::LmStudio => {
                let response = self.get("/api/v1/models").await?;
                response["models"]
                    .as_array()
                    .ok_or("Unexpected LM Studio model list.")?
                    .iter()
                    .filter(|m| m["type"] == "llm" && m["capabilities"]["vision"] == true)
                    .filter_map(|m| {
                        Model::from(
                            m.pointer("/loaded_instances/0/id")
                                .and_then(Value::as_str)
                                .or(m["key"].as_str()),
                            m["display_name"].as_str(),
                        )
                    })
                    .collect()
            }
            Provider::OpenRouter => {
                self.get("/key").await?; // The public catalog alone does not validate credentials.
                catalog(&self.get("/models?input_modalities=image&output_modalities=text&endpoints=/api/v1/chat/completions").await?)?
            }
            Provider::Cloudflare => catalog(
                &self
                    .get("/models/search?format=openrouter&per_page=100")
                    .await?,
            )?,
        };
        models.sort_by(|a, b| a.name.cmp(&b.name));
        models.dedup_by(|a, b| a.id == b.id);
        Ok(models)
    }
    /// Speech to text for a clip's audio (16 kHz mono MP3) with Whisper large v3 turbo, the model clip-ai transcribes with
    /// (service/pipeline.py transcription_model). Local providers have no speech model.
    pub async fn transcribe(&self, mp3: &[u8], language: Option<&str>) -> Result<Value> {
        if self.config.provider == Provider::Whisper {
            return self.transcribe_locally(mp3, language).await;
        }
        let audio = STANDARD.encode(mp3);
        let (route, mut body) = match self.config.provider {
            // Only endpoints that keep nothing and train on nothing (clip-ai PRIVATE_ROUTING).
            Provider::OpenRouter => (
                "/audio/transcriptions",
                json!({"model":"openai/whisper-large-v3-turbo","input_audio":{"data":audio,"format":"mp3"},
                       "response_format":"verbose_json","timestamp_granularities":["word","segment"],
                       "provider":{"zdr":true,"data_collection":"deny"}}),
            ),
            Provider::Cloudflare => (
                "/run/@cf/openai/whisper-large-v3-turbo",
                json!({"audio":audio,"task":"transcribe"}),
            ),
            _ => {
                return Err(format!(
                    "{} has no speech-to-text model. Connect OpenRouter or Cloudflare in Highlight finder to make captions.",
                    self.config.label()
                ))
            }
        };
        // A language told up front (ISO 639-1) instead of detected. Both providers take the same field.
        if let Some(language) = language {
            body["language"] = json!(language);
        }
        let response = self
            .json(self.req(reqwest::Method::POST, route).json(&body))
            .await?;
        // Cloudflare's REST API wraps the model's answer in {"result": ...}.
        Ok(match response.get("result") {
            Some(inner) if inner.is_object() => inner.clone(),
            _ => response,
        })
    }
    /// Speech to text on this computer: OpenAI's transcription request (a multipart upload) to a local Whisper
    /// server, asking for timed words. A server that only times its segments still works: their words are spread over
    /// each segment's time when the transcript is read (captions.rs transcript_words).
    async fn transcribe_locally(&self, mp3: &[u8], language: Option<&str>) -> Result<Value> {
        let part = reqwest::multipart::Part::bytes(mp3.to_vec())
            .file_name("audio.mp3")
            .mime_str("audio/mpeg")
            .map_err(|e| e.to_string())?;
        let model = self
            .config
            .model
            .as_deref()
            .map(str::trim)
            .filter(|m| !m.is_empty() && m.len() <= 200)
            .unwrap_or("whisper-1")
            .to_string();
        let mut form = reqwest::multipart::Form::new()
            .part("file", part)
            .text("model", model)
            .text("response_format", "verbose_json")
            .text("timestamp_granularities[]", "word")
            .text("timestamp_granularities[]", "segment");
        if let Some(language) = language {
            form = form.text("language", language.to_string());
        }
        // A model on a CPU can take a while over a 10-minute part.
        self.json(
            self.req(reqwest::Method::POST, "/v1/audio/transcriptions")
                .timeout(Duration::from_secs(3600))
                .multipart(form),
        )
        .await
    }
    /// A text-only answer (the transcript's highlights): a system brief and the user's text, answered as JSON.
    pub async fn chat(&self, model: &str, system: &str, user: &str) -> Result<String> {
        if model.trim().is_empty() || model.len() > 300 || model.chars().any(char::is_control) {
            return Err("Choose a model.".into());
        }
        let messages = json!([{"role":"system","content":system},{"role":"user","content":user}]);
        let (route, body) = if self.config.provider == Provider::Ollama {
            // Ollama's default context is a few thousand tokens and silently drops the rest: size it to the transcript.
            let context = ((system.len() + user.len()) / 3 + 4096).clamp(8192, 131_072);
            (
                "/api/chat",
                json!({"model":model,"stream":false,"format":"json","messages":messages,
                       "options":{"temperature":0.2,"num_ctx":context}}),
            )
        } else {
            let route = match self.config.provider {
                Provider::OpenRouter => "/chat/completions",
                _ => "/v1/chat/completions",
            };
            let mut body =
                json!({"model":model,"stream":false,"temperature":0.2,"messages":messages});
            if let Some(quick) = quick_answer(self.config.provider, model) {
                body.as_object_mut().unwrap().extend(quick);
            }
            (route, body)
        };
        // A long transcript takes a while to read.
        let res = self
            .json(
                self.req(reqwest::Method::POST, route)
                    .timeout(Duration::from_secs(900))
                    .json(&body),
            )
            .await?;
        let text = if self.config.provider == Provider::Ollama {
            res.pointer("/message/content").and_then(Value::as_str)
        } else {
            res.pointer("/choices/0/message/content")
                .and_then(Value::as_str)
        };
        text.map(str::to_owned)
            .ok_or_else(|| "The provider returned no highlight suggestions.".into())
    }
    pub async fn generate(&self, model: &str, prompt: &str, image: String) -> Result<String> {
        if model.trim().is_empty() || model.len() > 300 || model.chars().any(char::is_control) {
            return Err("Choose a vision model.".into());
        }
        let (route, body) = if self.config.provider == Provider::Ollama {
            if !self.ollama_vision(model).await? {
                return Err(
                    "Choose an installed local Ollama vision model and refresh the list.".into(),
                );
            }
            (
                "/api/generate",
                json!({"model":model,"stream":false,"format":"json","images":[image],"prompt":prompt,"options":{"temperature":0.2}}),
            )
        } else {
            let route = match self.config.provider {
                Provider::OpenRouter => "/chat/completions",
                _ => "/v1/chat/completions",
            };
            let mut body = json!({"model":model,"stream":false,"messages":[{"role":"user","content":[{"type":"text","text":prompt},{"type":"image_url","image_url":{"url":format!("data:image/jpeg;base64,{image}")}}]}]});
            if let Some(quick) = quick_answer(self.config.provider, model) {
                body.as_object_mut().unwrap().extend(quick);
            }
            (route, body)
        };
        let res = self
            .json(self.req(reqwest::Method::POST, route).json(&body))
            .await?;
        let text = if self.config.provider == Provider::Ollama {
            res["response"].as_str()
        } else {
            res.pointer("/choices/0/message/content")
                .and_then(Value::as_str)
        };
        text.map(str::to_owned)
            .ok_or_else(|| "The provider returned no highlight suggestions.".into())
    }
}
/// Workers AI reasoning models think before they answer unless told not to, and that thinking is
/// most of the wait. The answer here is a few lines of JSON. Gemma 4 can switch thinking off;
/// Qwen 3.8 defaults to `xhigh` and can only be lowered. Other models get no extra fields.
fn quick_answer(provider: Provider, model: &str) -> Option<serde_json::Map<String, Value>> {
    if provider != Provider::Cloudflare {
        return None;
    }
    let extra = if model.starts_with("@cf/google/gemma-4") {
        json!({"chat_template_kwargs":{"enable_thinking":false}})
    } else if model.starts_with("@cf/qwen/qwen3.8") {
        json!({"reasoning_effort":"low"})
    } else {
        return None;
    };
    extra.as_object().cloned()
}
fn provider_failure(code: u16, body: &str) -> String {
    let message = serde_json::from_str::<Value>(body).ok().and_then(|v| {
        v["errors"]
            .get(0)
            .and_then(|e| e["message"].as_str())
            .or_else(|| v.pointer("/error/message").and_then(Value::as_str))
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|s| s.chars().take(280).collect())
    });
    if let Some(message) = message {
        return message;
    }
    match code {
        401 | 403 => "Check your API token and account permissions.".into(),
        402 => "Check your provider's billing balance.".into(),
        404 => "Check the server version, account, gateway, or model ID.".into(),
        400 | 422 => "Check that the selected model accepts image inputs and is available.".into(),
        429 => "The rate limit was reached. Try again later.".into(),
        _ => "Check provider availability and the model configuration.".into(),
    }
}
fn contains(v: &Value, s: &str) -> bool {
    v.as_array().is_some_and(|a| a.iter().any(|x| x == s))
}
/// OpenRouter nests modalities under `architecture`. Cloudflare's openrouter
/// catalog format puts the same arrays on the model itself.
fn modalities<'a>(model: &'a Value, kind: &str) -> &'a Value {
    model
        .get("architecture")
        .and_then(|arch| arch.get(kind))
        .unwrap_or(&model[kind])
}
fn catalog(v: &Value) -> Result<Vec<Model>> {
    let rows = v["data"]
        .as_array()
        .or_else(|| v.pointer("/result/data").and_then(Value::as_array))
        .ok_or("The provider returned an unexpected model catalog.")?;
    Ok(rows
        .iter()
        .filter(|m| {
            contains(modalities(m, "input_modalities"), "image")
                && contains(modalities(m, "output_modalities"), "text")
        })
        .filter_map(|m| Model::from(m["id"].as_str(), m["name"].as_str()))
        .collect())
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Discovery {
    models: Vec<Model>,
    preferred_model: Option<String>,
}
#[tauri::command]
pub async fn connect_ai(connection: Connection, api_key: Option<String>) -> Result<Discovery> {
    let session = Session::new(connection, api_key.as_deref()).await?;
    let models = session.models().await?;
    if let Some(key) = api_key.filter(|s| !s.trim().is_empty()) {
        credential(&session.config, Secret::Save(key.trim().into())).await?;
    }
    let preferred_model = match session.config.provider {
        Provider::Ollama => std::env::var("QUIKCLIP_MODEL")
            .ok()
            .or(Some("gemma3:4b".into())),
        Provider::Cloudflare => Some("@cf/google/gemma-4-26b-a4b-it".into()),
        _ => None,
    };
    Ok(Discovery {
        models,
        preferred_model,
    })
}
#[tauri::command]
pub async fn forget_ai(connection: Connection) -> Result<()> {
    connection.base()?;
    credential(&connection, Secret::Delete).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tiny_http::{Response, Server};

    #[tokio::test]
    async fn discovers_models_and_sends_the_selected_image_model_to_each_provider() {
        for provider in [
            Provider::OpenRouter,
            Provider::Cloudflare,
            Provider::Ollama,
            Provider::LmStudio,
        ] {
            let config = Connection {
                provider,
                port: None,
                account_id: Some("a".repeat(32)),
                gateway: Some("studio".into()),
                model: None,
            };
            let mut session = Session::new(config, Some("fixture-token")).await.unwrap();
            let server = Server::http("127.0.0.1:0").unwrap();
            session.base = format!("http://{}", server.server_addr());
            let worker = std::thread::spawn(move || loop {
                let mut req = server
                    .recv_timeout(Duration::from_secs(8))
                    .unwrap()
                    .expect("request");
                let path = req.url().split('?').next().unwrap().to_owned();
                let mut body = String::new();
                req.as_reader().read_to_string(&mut body).unwrap();
                let body: Value = serde_json::from_str(&body).unwrap_or(Value::Null);
                if provider == Provider::Cloudflare {
                    assert!(req
                        .headers()
                        .iter()
                        .any(|h| h.field.equiv("cf-aig-gateway-id") && h.value == "studio"));
                }
                if matches!(provider, Provider::OpenRouter | Provider::Cloudflare) {
                    assert!(req.headers().iter().any(
                        |h| h.field.equiv("Authorization") && h.value == "Bearer fixture-token"
                    ));
                }
                let data = match path.as_str() {
                    "/key" => json!({"data":{}}),
                    "/models" => {
                        json!({"data":[{"id":"text","architecture":{"input_modalities":["text"],"output_modalities":["text"]}},{"id":"vision","architecture":{"input_modalities":["text","image"],"output_modalities":["text"]}}]})
                    }
                    // Cloudflare's openrouter format lists modalities on the model, not under architecture.
                    "/models/search" => {
                        json!({"data":[{"id":"text","input_modalities":["text"],"output_modalities":["text"]},{"id":"vision","name":"Vision","input_modalities":["text","image"],"output_modalities":["text"]}]})
                    }
                    "/api/tags" => {
                        json!({"models":[{"name":"vision"},{"name":"remote:cloud"},{"name":"text"}]})
                    }
                    "/api/show" => {
                        json!({"capabilities":if body["model"]=="vision"{vec!["completion","vision"]}else{vec!["completion"]}})
                    }
                    "/api/v1/models" => {
                        json!({"models":[{"type":"llm","key":"vision","capabilities":{"vision":true}},{"type":"embedding","key":"embed"}]})
                    }
                    "/api/generate" => {
                        assert_eq!(body["model"], "vision");
                        assert_eq!(body["images"][0], "YWJj");
                        json!({"response":"suggestions"})
                    }
                    "/chat/completions" | "/v1/chat/completions" => {
                        assert_eq!(
                            path,
                            if provider == Provider::OpenRouter {
                                "/chat/completions"
                            } else {
                                "/v1/chat/completions"
                            }
                        );
                        assert_eq!(body["model"], "vision");
                        assert_eq!(
                            body.pointer("/messages/0/content/1/image_url/url"),
                            Some(&json!("data:image/jpeg;base64,YWJj"))
                        );
                        json!({"choices":[{"message":{"content":"suggestions"}}]})
                    }
                    _ => panic!("unexpected {path}"),
                };
                req.respond(Response::from_string(data.to_string()))
                    .unwrap();
                if path.ends_with("completions") || path.ends_with("generate") {
                    break;
                }
            });
            let models = session.models().await.unwrap();
            assert_eq!(models.len(), 1);
            assert_eq!(models[0].id, "vision");
            assert_eq!(
                session
                    .generate(&models[0].id, "find highlights", "YWJj".into())
                    .await
                    .unwrap(),
                "suggestions"
            );
            worker.join().unwrap();
        }
    }

    #[tokio::test]
    async fn a_local_whisper_server_gets_an_openai_upload() {
        let config = Connection {
            provider: Provider::Whisper,
            port: Some(9),
            account_id: None,
            gateway: None,
            model: Some("Systran/faster-whisper-small".into()),
        };
        let mut session = Session::new(config, None).await.unwrap();
        let server = Server::http("127.0.0.1:0").unwrap();
        session.base = format!("http://{}", server.server_addr());
        let worker = std::thread::spawn(move || {
            let mut req = server
                .recv_timeout(Duration::from_secs(8))
                .unwrap()
                .expect("request");
            assert_eq!(req.url(), "/v1/audio/transcriptions");
            let kind = req
                .headers()
                .iter()
                .find(|h| h.field.equiv("Content-Type"))
                .map(|h| h.value.to_string())
                .unwrap();
            assert!(kind.starts_with("multipart/form-data"));
            let mut body = String::new();
            req.as_reader().read_to_string(&mut body).unwrap();
            for part in [
                "name=\"model\"\r\n\r\nSystran/faster-whisper-small",
                "name=\"response_format\"\r\n\r\nverbose_json",
                "name=\"timestamp_granularities[]\"\r\n\r\nword",
                "name=\"language\"\r\n\r\nid",
                "filename=\"audio.mp3\"",
                "mp3",
            ] {
                assert!(body.contains(part), "missing {part}");
            }
            // A server that times only its segments.
            let answer = json!({"text":"halo semua","segments":[{"start":0.0,"end":1.0,"text":"halo semua"}]});
            req.respond(Response::from_string(answer.to_string()))
                .unwrap();
        });
        let transcript = session.transcribe(b"mp3", Some("id")).await.unwrap();
        worker.join().unwrap();
        let words = crate::captions::transcript_words(&transcript, 10.0);
        assert_eq!(words.len(), 2);
        assert_eq!((words[0].start, words[1].end), (10.0, 11.0));
    }
    #[tokio::test]
    async fn speech_goes_to_whisper_and_comes_back_as_a_transcript() {
        for provider in [Provider::OpenRouter, Provider::Cloudflare] {
            let config = Connection {
                provider,
                port: None,
                account_id: Some("a".repeat(32)),
                gateway: Some("studio".into()),
                model: None,
            };
            let mut session = Session::new(config, Some("fixture-token")).await.unwrap();
            let server = Server::http("127.0.0.1:0").unwrap();
            session.base = format!("http://{}", server.server_addr());
            let worker = std::thread::spawn(move || {
                let mut req = server
                    .recv_timeout(Duration::from_secs(8))
                    .unwrap()
                    .expect("request");
                let path = req.url().to_owned();
                let mut body = String::new();
                req.as_reader().read_to_string(&mut body).unwrap();
                let body: Value = serde_json::from_str(&body).unwrap();
                let answer = if provider == Provider::OpenRouter {
                    assert_eq!(path, "/audio/transcriptions");
                    assert_eq!(body["model"], "openai/whisper-large-v3-turbo");
                    assert_eq!(body["input_audio"], json!({"data":"bXAz","format":"mp3"}));
                    assert_eq!(body["response_format"], "verbose_json");
                    assert_eq!(body["timestamp_granularities"], json!(["word", "segment"]));
                    assert_eq!(body["provider"]["zdr"], true);
                    json!({"text":"hi","language":"english","words":[{"word":"hi","start":0.1,"end":0.3}]})
                } else {
                    assert_eq!(path, "/run/@cf/openai/whisper-large-v3-turbo");
                    assert_eq!(body, json!({"audio":"bXAz","task":"transcribe"}));
                    json!({"result":{"text":"hi","segments":[{"start":0.1,"end":0.3,"text":"hi","words":[{"word":"hi","start":0.1,"end":0.3}]}]},"success":true,"errors":[],"messages":[]})
                };
                req.respond(Response::from_string(answer.to_string()))
                    .unwrap();
            });
            let transcript = session.transcribe(b"mp3", None).await.unwrap();
            assert_eq!(transcript["text"], "hi");
            assert_eq!(
                crate::captions::transcript_words(&transcript, 5.0),
                vec![crate::captions::Word {
                    start: 5.1,
                    end: 5.3,
                    text: "hi".into()
                }]
            );
            worker.join().unwrap();
        }
        let local = Session::new(
            Connection {
                provider: Provider::Ollama,
                port: None,
                account_id: None,
                gateway: None,
                model: None,
            },
            None,
        )
        .await
        .unwrap();
        assert!(local
            .transcribe(b"mp3", None)
            .await
            .unwrap_err()
            .contains("no speech-to-text model"));
    }

    #[tokio::test]
    async fn a_transcript_is_read_as_text_by_every_provider() {
        for provider in [
            Provider::OpenRouter,
            Provider::Cloudflare,
            Provider::Ollama,
            Provider::LmStudio,
        ] {
            let config = Connection {
                provider,
                port: None,
                account_id: Some("a".repeat(32)),
                gateway: None,
                model: None,
            };
            let session = Session::new(config, Some("fixture-token")).await.unwrap();
            let server = Server::http("127.0.0.1:0").unwrap();
            let session = session.with_base(format!("http://{}", server.server_addr()));
            let worker = std::thread::spawn(move || {
                let mut req = server
                    .recv_timeout(Duration::from_secs(8))
                    .unwrap()
                    .expect("request");
                let path = req.url().to_owned();
                let mut body = String::new();
                req.as_reader().read_to_string(&mut body).unwrap();
                let body: Value = serde_json::from_str(&body).unwrap();
                assert_eq!(body["messages"][0]["role"], "system");
                assert_eq!(body["messages"][1]["content"], "<transcript>");
                assert!(body.pointer("/messages/1/content/1").is_none(), "no image");
                let answer = match provider {
                    Provider::Ollama => {
                        assert_eq!(path, "/api/chat");
                        assert_eq!(body["options"]["num_ctx"], 8192);
                        json!({"message":{"content":"{\"clips\":[]}"}})
                    }
                    Provider::OpenRouter => {
                        assert_eq!(path, "/chat/completions");
                        json!({"choices":[{"message":{"content":"{\"clips\":[]}"}}]})
                    }
                    _ => {
                        assert_eq!(path, "/v1/chat/completions");
                        if provider == Provider::Cloudflare {
                            assert_eq!(body["chat_template_kwargs"]["enable_thinking"], false);
                        }
                        json!({"choices":[{"message":{"content":"{\"clips\":[]}"}}]})
                    }
                };
                req.respond(Response::from_string(answer.to_string()))
                    .unwrap();
            });
            let model = if provider == Provider::Cloudflare {
                "@cf/google/gemma-4-26b-a4b-it"
            } else {
                "vision"
            };
            assert_eq!(
                session.chat(model, "brief", "<transcript>").await.unwrap(),
                "{\"clips\":[]}"
            );
            worker.join().unwrap();
        }
    }

    #[test]
    fn cloudflare_reasoning_models_answer_without_long_thinking() {
        let gemma = quick_answer(Provider::Cloudflare, "@cf/google/gemma-4-26b-a4b-it").unwrap();
        assert_eq!(gemma["chat_template_kwargs"]["enable_thinking"], false);
        let qwen = quick_answer(Provider::Cloudflare, "@cf/qwen/qwen3.8-27b").unwrap();
        assert_eq!(qwen["reasoning_effort"], "low");
        assert!(quick_answer(
            Provider::Cloudflare,
            "@cf/meta/llama-3.2-11b-vision-instruct"
        )
        .is_none());
        assert!(quick_answer(Provider::OpenRouter, "google/gemma-4-26b-a4b-it").is_none());
    }

    #[test]
    fn a_provider_error_keeps_its_own_message() {
        let body =
            r#"{"errors":[{"message":"Model Agreement: submit agree before using this model."}]}"#;
        assert_eq!(
            provider_failure(403, body),
            "Model Agreement: submit agree before using this model."
        );
        assert_eq!(
            provider_failure(403, ""),
            "Check your API token and account permissions."
        );
    }
}
