use std::time::Duration;

use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpStream,
    time::timeout,
};

const USAGE_CHANNEL: &str = "usage";
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const IO_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_FRAME_BYTES: usize = 16 * 1024 * 1024;
const MAX_ARRAY_LENGTH: usize = 10_000;
const MAX_NESTING_DEPTH: usize = 8;

pub(super) struct UsageSubscription {
    stream: TcpStream,
    read_buffer: Vec<u8>,
}

impl UsageSubscription {
    pub(super) async fn connect(port: u16, management_key: &str) -> Result<Self, String> {
        let address = format!("127.0.0.1:{port}");
        let stream = timeout(CONNECT_TIMEOUT, TcpStream::connect(&address))
            .await
            .map_err(|_| format!("Timed out connecting to the CPA usage subscription: {address}"))?
            .map_err(|error| format!("Failed to connect to the CPA usage subscription {address}: {error}"))?;
        let mut subscription = Self {
            stream,
            read_buffer: Vec::new(),
        };
        subscription.send_command(&["AUTH", management_key]).await?;
        match subscription.read_frame().await? {
            RespValue::Simple(value) if value.eq_ignore_ascii_case("OK") => {}
            RespValue::Error(error) => return Err(format!("CPA usage subscription authentication failed: {error}")),
            value => return Err(format!("Invalid CPA usage subscription authentication response: {}", value.kind())),
        }
        subscription
            .send_command(&["SUBSCRIBE", USAGE_CHANNEL])
            .await?;
        let acknowledgement = subscription.read_frame().await?;
        if !is_subscription_ack(&acknowledgement) {
            return Err("CPA did not acknowledge the usage subscription".to_string());
        }
        Ok(subscription)
    }

    pub(super) async fn next_message(&mut self) -> Result<String, String> {
        loop {
            let frame = self.read_frame().await?;
            if let Some(payload) = subscription_payload(&frame) {
                return Ok(payload);
            }
            if let RespValue::Error(error) = frame {
                return Err(format!("CPA usage subscription returned an error: {error}"));
            }
        }
    }

    async fn send_command(&mut self, parts: &[&str]) -> Result<(), String> {
        let mut command = format!("*{}\r\n", parts.len()).into_bytes();
        for part in parts {
            command.extend_from_slice(format!("${}\r\n", part.len()).as_bytes());
            command.extend_from_slice(part.as_bytes());
            command.extend_from_slice(b"\r\n");
        }
        timeout(IO_TIMEOUT, self.stream.write_all(&command))
            .await
            .map_err(|_| "Timed out writing the CPA usage subscription command".to_string())?
            .map_err(|error| format!("Failed to write the CPA usage subscription command: {error}"))
    }

    async fn read_frame(&mut self) -> Result<RespValue, String> {
        loop {
            match parse_resp_frame(&self.read_buffer, 0, 0)? {
                ParseResult::Complete(value, consumed) => {
                    self.read_buffer.drain(..consumed);
                    return Ok(value);
                }
                ParseResult::Incomplete => {}
            }
            if self.read_buffer.len() >= MAX_FRAME_BYTES {
                return Err("CPA usage subscription response exceeds the size limit".to_string());
            }
            let mut chunk = [0_u8; 8192];
            let read = timeout(IO_TIMEOUT, self.stream.read(&mut chunk))
                .await
                .map_err(|_| "Timed out reading the CPA usage subscription response".to_string())?
                .map_err(|error| format!("Failed to read the CPA usage subscription response: {error}"))?;
            if read == 0 {
                return Err("CPA usage subscription connection closed".to_string());
            }
            self.read_buffer.extend_from_slice(&chunk[..read]);
        }
    }
}

#[derive(Debug)]
enum RespValue {
    Simple(String),
    Error(String),
    Integer(i64),
    Bulk(Option<Vec<u8>>),
    Array(Option<Vec<RespValue>>),
}

impl RespValue {
    fn kind(&self) -> &'static str {
        match self {
            Self::Simple(_) => "simple string",
            Self::Error(_) => "error",
            Self::Integer(_) => "integer",
            Self::Bulk(_) => "bulk string",
            Self::Array(_) => "array",
        }
    }

    fn text(&self) -> Option<String> {
        match self {
            Self::Simple(value) | Self::Error(value) => Some(value.clone()),
            Self::Bulk(Some(value)) => String::from_utf8(value.clone()).ok(),
            Self::Integer(value) => Some(value.to_string()),
            Self::Bulk(None) | Self::Array(_) => None,
        }
    }
}

enum ParseResult {
    Complete(RespValue, usize),
    Incomplete,
}

fn parse_resp_frame(input: &[u8], offset: usize, depth: usize) -> Result<ParseResult, String> {
    if depth > MAX_NESTING_DEPTH {
        return Err("CPA usage subscription response nesting is too deep".to_string());
    }
    let Some(prefix) = input.get(offset).copied() else {
        return Ok(ParseResult::Incomplete);
    };
    match prefix {
        b'+' | b'-' | b':' => {
            let Some((line, next)) = resp_line(input, offset + 1) else {
                return Ok(ParseResult::Incomplete);
            };
            let text = String::from_utf8(line.to_vec())
                .map_err(|_| "CPA usage subscription text response is not valid UTF-8".to_string())?;
            let value = match prefix {
                b'+' => RespValue::Simple(text),
                b'-' => RespValue::Error(text),
                _ => RespValue::Integer(
                    text.parse::<i64>()
                        .map_err(|_| "Invalid CPA usage subscription integer response".to_string())?,
                ),
            };
            Ok(ParseResult::Complete(value, next - offset))
        }
        b'$' => {
            let Some((line, data_start)) = resp_line(input, offset + 1) else {
                return Ok(ParseResult::Incomplete);
            };
            let length = parse_resp_length(line)?;
            if length < 0 {
                return Ok(ParseResult::Complete(
                    RespValue::Bulk(None),
                    data_start - offset,
                ));
            }
            let length =
                usize::try_from(length).map_err(|_| "Invalid CPA usage subscription string length".to_string())?;
            if length > MAX_FRAME_BYTES {
                return Err("CPA usage subscription string exceeds the size limit".to_string());
            }
            let data_end = data_start.saturating_add(length);
            let frame_end = data_end.saturating_add(2);
            if input.len() < frame_end {
                return Ok(ParseResult::Incomplete);
            }
            if input.get(data_end..frame_end) != Some(b"\r\n") {
                return Err("Invalid CPA usage subscription string terminator".to_string());
            }
            Ok(ParseResult::Complete(
                RespValue::Bulk(Some(input[data_start..data_end].to_vec())),
                frame_end - offset,
            ))
        }
        b'*' => {
            let Some((line, mut next)) = resp_line(input, offset + 1) else {
                return Ok(ParseResult::Incomplete);
            };
            let length = parse_resp_length(line)?;
            if length < 0 {
                return Ok(ParseResult::Complete(RespValue::Array(None), next - offset));
            }
            let length =
                usize::try_from(length).map_err(|_| "Invalid CPA usage subscription array length".to_string())?;
            if length > MAX_ARRAY_LENGTH {
                return Err("CPA usage subscription array exceeds the size limit".to_string());
            }
            let mut values = Vec::with_capacity(length);
            for _ in 0..length {
                match parse_resp_frame(input, next, depth + 1)? {
                    ParseResult::Complete(value, consumed) => {
                        values.push(value);
                        next = next.saturating_add(consumed);
                    }
                    ParseResult::Incomplete => return Ok(ParseResult::Incomplete),
                }
            }
            Ok(ParseResult::Complete(
                RespValue::Array(Some(values)),
                next - offset,
            ))
        }
        _ => Err("Invalid CPA usage subscription response type".to_string()),
    }
}

fn resp_line(input: &[u8], start: usize) -> Option<(&[u8], usize)> {
    let relative_end = input
        .get(start..)?
        .windows(2)
        .position(|pair| pair == b"\r\n")?;
    let end = start + relative_end;
    Some((&input[start..end], end + 2))
}

fn parse_resp_length(value: &[u8]) -> Result<i64, String> {
    std::str::from_utf8(value)
        .map_err(|_| "CPA usage subscription length is not valid UTF-8".to_string())?
        .parse::<i64>()
        .map_err(|_| "Invalid CPA usage subscription length".to_string())
}

fn is_subscription_ack(value: &RespValue) -> bool {
    let RespValue::Array(Some(values)) = value else {
        return false;
    };
    values.len() >= 2
        && values[0]
            .text()
            .is_some_and(|value| value.eq_ignore_ascii_case("subscribe"))
        && values[1].text().as_deref() == Some(USAGE_CHANNEL)
}

fn subscription_payload(value: &RespValue) -> Option<String> {
    let RespValue::Array(Some(values)) = value else {
        return None;
    };
    if values.len() < 3
        || !values[0]
            .text()
            .is_some_and(|value| value.eq_ignore_ascii_case("message"))
        || values[1].text().as_deref() != Some(USAGE_CHANNEL)
    {
        return None;
    }
    values[2].text()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::net::TcpListener;

    #[test]
    fn parses_usage_subscription_message() {
        let input = b"*3\r\n$7\r\nmessage\r\n$5\r\nusage\r\n$16\r\n{\"request_id\":1}\r\n";
        let ParseResult::Complete(value, consumed) = parse_resp_frame(input, 0, 0).unwrap() else {
            panic!("expected complete RESP frame");
        };
        assert_eq!(consumed, input.len());
        assert_eq!(
            subscription_payload(&value).as_deref(),
            Some("{\"request_id\":1}")
        );
    }

    #[test]
    fn rejects_oversized_arrays() {
        let error = match parse_resp_frame(b"*10001\r\n", 0, 0) {
            Err(error) => error,
            _ => panic!("expected oversized RESP array to fail"),
        };
        assert!(error.contains("array exceeds the size limit"));
    }

    #[tokio::test]
    async fn authenticates_subscribes_and_receives_usage_payload() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let expected_auth = b"*2\r\n$4\r\nAUTH\r\n$6\r\nsecret\r\n";
            let mut auth = vec![0_u8; expected_auth.len()];
            stream.read_exact(&mut auth).await.unwrap();
            assert_eq!(auth, expected_auth);
            stream.write_all(b"+OK\r\n").await.unwrap();

            let expected_subscribe = b"*2\r\n$9\r\nSUBSCRIBE\r\n$5\r\nusage\r\n";
            let mut subscribe = vec![0_u8; expected_subscribe.len()];
            stream.read_exact(&mut subscribe).await.unwrap();
            assert_eq!(subscribe, expected_subscribe);
            stream
                .write_all(b"*3\r\n$9\r\nsubscribe\r\n$5\r\nusage\r\n:1\r\n")
                .await
                .unwrap();
            stream
                .write_all(b"*3\r\n$7\r\nmessage\r\n$5\r\nusage\r\n$16\r\n{\"request_id\":1}\r\n")
                .await
                .unwrap();
        });

        let mut subscription = UsageSubscription::connect(port, "secret").await.unwrap();
        assert_eq!(
            subscription.next_message().await.unwrap(),
            "{\"request_id\":1}"
        );
        server.await.unwrap();
    }
}
