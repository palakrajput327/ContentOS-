# Domain & Server Backup Details

Yeh file purane aur original server/DNS details ka permanent backup hai:

| Detail | Value | Notes |
| :--- | :--- | :--- |
| **Original Hosting / cPanel Server IP** | `103.243.232.111` | HostyCare cPanel server (`hindust1` account) |
| **Original SPF Record** | `"v=spf1 +a +mx +ip4:103.243.232.111 ~all"` | Mail/Server SPF record |
| **HostyCare Nameserver 1** | `ns1.hostycare.online` (`103.243.232.44`) | Primary Hosting Nameserver |
| **HostyCare Nameserver 2** | `ns2.hostycare.online` (`103.243.232.111`) | Secondary Hosting Nameserver |
| **cPanel Username** | `hindust1` | HostyCare cPanel account |
| **Domain Name** | `hidustansocialnetwork.in` | Main Domain |

---

### New Cloud Setup (Free Tier)
- **Frontend**: Vercel (`216.198.79.1` / `cname.vercel-dns.com`)
- **Backend API**: Render (`https://contentos-8h17.onrender.com`)
- **Database**: Neon Cloud PostgreSQL (Singapore Region)
