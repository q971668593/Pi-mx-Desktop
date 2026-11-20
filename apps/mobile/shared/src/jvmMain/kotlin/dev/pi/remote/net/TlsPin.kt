package dev.pi.remote.net

import dev.pi.remote.protocol.Base64Url
import java.security.KeyStore
import java.security.MessageDigest
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import javax.net.ssl.HostnameVerifier
import javax.net.ssl.TrustManagerFactory
import javax.net.ssl.X509TrustManager

/**
 * Trust policy for the gateway socket (`wss://`).
 *
 * Two ways to be accepted:
 *  1. the leaf certificate's SPKI hash equals the fingerprint stored when this phone paired
 *     (`tls` in the pair link) — the desktop minted a self-signed certificate, so there is no chain;
 *  2. the chain validates against the system trust store — that is a tunnel (Cloudflare, frp with a
 *     real domain) terminating TLS in front of the desktop.
 *
 * Either way the session itself is still authenticated by the host's static X25519 key from the QR,
 * so a wrong certificate can at worst make us fail to connect, never impersonate the desktop.
 */
class PinnedTrustManager(private val pin: String?) : X509TrustManager {
    private val system: X509TrustManager? = runCatching {
        TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm())
            .apply { init(null as KeyStore?) }
            .trustManagers
            .filterIsInstance<X509TrustManager>()
            .firstOrNull()
    }.getOrNull()

    override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) {
        throw CertificateException("client certificates are not used")
    }

    override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {
        val leaf = chain?.firstOrNull() ?: throw CertificateException("empty certificate chain")
        if (pin != null && spkiSha256(leaf) == pin) return
        val fallback = system ?: throw CertificateException("no system trust store")
        // Throws when the chain is not publicly trusted either.
        fallback.checkServerTrusted(chain, authType)
    }

    override fun getAcceptedIssuers(): Array<X509Certificate> = system?.acceptedIssuers ?: emptyArray()

    companion object {
        fun spkiSha256(cert: X509Certificate): String =
            Base64Url.encode(MessageDigest.getInstance("SHA-256").digest(cert.publicKey.encoded))
    }
}

/** Runs after the trust manager: a pinned self-signed certificate has no meaningful hostname. */
fun pinnedHostnameVerifier(pin: String?): HostnameVerifier = HostnameVerifier { hostname, session ->
    val leaf = runCatching { session?.peerCertificates?.firstOrNull() as? X509Certificate }.getOrNull()
    if (pin != null && leaf != null && PinnedTrustManager.spkiSha256(leaf) == pin) {
        true
    } else {
        // Public certificate (tunnel): the platform verifies the name as usual.
        javax.net.ssl.HttpsURLConnection.getDefaultHostnameVerifier().verify(hostname, session)
    }
}
