package dev.pi.remote.protocol

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class EndpointPolicyTest {
    @Test fun privateEndpointsAllowBothSchemes() {
        assertTrue(Pairing.isAllowedEndpoint("ws://192.168.1.5:47900"))
        assertTrue(Pairing.isAllowedEndpoint("wss://192.168.1.5:47900"))
        assertTrue(Pairing.isAllowedEndpoint("wss://[fe80::1%wlan0]:47900"))
        assertFalse(Pairing.isAllowedEndpoint("ws://203.0.113.7:7000"))
        assertFalse(Pairing.isAllowedEndpoint("wss://pi.example.com:7000"))
    }

    @Test fun publicEndpointsMustBeEncrypted() {
        assertTrue(Pairing.isPublicEndpoint("wss://203.0.113.7:7000"))
        assertTrue(Pairing.isPublicEndpoint("wss://pi.example.com:8443/"))
        assertTrue(Pairing.isPublicEndpoint("wss://[2001:db8::1]:7000"))
        // 明文公网一律拒绝；私网地址走 isAllowedEndpoint
        assertFalse(Pairing.isPublicEndpoint("ws://203.0.113.7:7000"))
        assertFalse(Pairing.isPublicEndpoint("ws://pi.example.com:7000"))
        assertFalse(Pairing.isPublicEndpoint("wss://192.168.1.5:47900"))
        assertFalse(Pairing.isPublicEndpoint("wss://pi.example.com"))
        assertFalse(Pairing.isPublicEndpoint("wss://pi.example.com:0"))
        assertFalse(Pairing.isPublicEndpoint("wss://pi.example.com:70000"))
        assertFalse(Pairing.isPublicEndpoint("wss://pi example.com:7000"))
        assertFalse(Pairing.isPublicEndpoint("wss://-pi.example.com:7000"))
    }

    @Test fun pairLinksCarryTunnelEndpointsAndDropPlaintextPublicOnes() {
        val tunnel = PairOffer(v = 1, hostId = "h", hostName = "pc", hostPub = "k", endpoints = listOf("wss://edge.trycloudflare.com:443"), pairToken = "t".repeat(16), exp = 0)
        assertEquals(listOf("wss://edge.trycloudflare.com:443"), Pairing.decodeLink(Pairing.encodeLink(tunnel))!!.endpoints)

        val plaintext = PairOffer(v = 1, hostId = "h", hostName = "pc", hostPub = "k", endpoints = listOf("ws://203.0.113.7:7000"), pairToken = "t".repeat(16), exp = 0)
        val error = runCatching { Pairing.decodeLink(Pairing.encodeLink(plaintext)) }.exceptionOrNull()
        assertTrue(error is PairLinkException)
    }

    @Test fun pairLinkKeepsTheTlsPin() {
        val offer = PairOffer(v = 1, hostId = "h", hostName = "pc", hostPub = "k", endpoints = listOf("wss://192.168.1.5:47900"), pairToken = "t".repeat(16), exp = 0, tls = "pin-value")
        val decoded = Pairing.decodeLink(Pairing.encodeLink(offer))!!
        assertEquals("pin-value", decoded.tls)
    }
}
