//! Native provider clients. Only non-secret connection details cross back to the UI.
use crate::media::Result;
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
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Connection {
    pub provider: Provider,
    pub port: Option<u16>,
    pub account_id: Option<String>,
    pub gateway: Option<String>,
}

impl Connection {
    fn port(&self) -> u16 {
        self.port.unwrap_or(if self.provider == Provider::Ollama {
            11434
        } else {
            1234
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
        }
    }
    fn base(&self) -> Result<String> {
        match self.provider {
            Provider::Ollama | Provider::LmStudio if self.port() == 0 => {
                Err("Enter a port between 1 and 65535.".into())
            }
            Provider::Ollama | Provider::LmStudio => {
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
            Provider::Ollama => None,
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
            let detail = match res.status().as_u16() {
                401 | 403 => "Check your API token and account permissions.",
                402 => "Check your provider's billing balance.",
                404 => "Check the server version, account, gateway, or model ID.",
                400 | 422 => "Check that the selected model accepts image inputs and is available.",
                429 => "The rate limit was reached. Try again later.",
                _ => "Check provider availability and the model configuration.",
            };
            return Err(format!(
                "{name} returned {}. {detail}",
                res.status().as_u16()
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
            (
                route,
                json!({"model":model,"stream":false,"messages":[{"role":"user","content":[{"type":"text","text":prompt},{"type":"image_url","image_url":{"url":format!("data:image/jpeg;base64,{image}")}}]}]}),
            )
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
fn contains(v: &Value, s: &str) -> bool {
    v.as_array().is_some_and(|a| a.iter().any(|x| x == s))
}
fn catalog(v: &Value) -> Result<Vec<Model>> {
    let rows = v["data"]
        .as_array()
        .or_else(|| v.pointer("/result/data").and_then(Value::as_array))
        .ok_or("The provider returned an unexpected model catalog.")?;
    Ok(rows
        .iter()
        .filter(|m| {
            contains(&m["architecture"]["input_modalities"], "image")
                && contains(&m["architecture"]["output_modalities"], "text")
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
    let preferred_model = if session.config.provider == Provider::Ollama {
        std::env::var("QUIKCLIP_MODEL")
            .ok()
            .or(Some("gemma3:4b".into()))
    } else {
        None
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
                    "/models" | "/models/search" => {
                        json!({"data":[{"id":"text","architecture":{"input_modalities":["text"],"output_modalities":["text"]}},{"id":"vision","architecture":{"input_modalities":["text","image"],"output_modalities":["text"]}}]})
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
}
