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
class PinnedTrustManager(private val pins: Set<String>) : X509TrustManager {
    constructor(pin: String?) : this(listOfNotNull(pin).toSet())

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
        // 电脑自己的证书，或自建中转（自签）那段的证书：两个指纹都在配对时给过
        if (spkiSha256(leaf) in pins) return
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
fun pinnedHostnameVerifier(pins: Set<String>): HostnameVerifier = HostnameVerifier { hostname, session ->
    val leaf = runCatching { session?.peerCertificates?.firstOrNull() as? X509Certificate }.getOrNull()
    if (leaf != null && PinnedTrustManager.spkiSha256(leaf) in pins) {
        true
    } else {
        // Public certificate (tunnel): the platform verifies the name as usual.
        javax.net.ssl.HttpsURLConnection.getDefaultHostnameVerifier().verify(hostname, session)
    }
}
