# dry-utils

This repository contains a variety of abstractions and helpers for my projects. It is an evolving collection of utilities that I find myself otherwise copying and pasting between projects. The goal is to make it easier to share code between projects, and to make it easier to use the same code in different contexts.

I do not anticipate that you will find this repository useful. It is hyper-specific to my needs. If you do find something useful, feel free to use it, fork it, or liberally copy code out into your own projects.

## Installation

dry-utils is available as an [npm package](https://www.npmjs.com/package/dry-utils).

```sh
npm install dry-utils
```

### OpenAI

When using OpenAI, you will need to set up an OpenAI account and create an API key. The OpenAI code expect .env to contain OPENAI_API_KEY, which is referenced directly in the OpenAI SDK.

### CosmosDB

- [Azure CosmosDB Emulator](https://learn.microsoft.com/en-us/azure/cosmos-db/local-emulator)
- [Azure CosmosDB Account](https://azure.microsoft.com/en-us/services/cosmos-db/)

CosmosDB has a local emulator that you can use for development. These instructions have been used on a direct-install emulator on Windows 10. A similar process should work on other versions of Windows or using the Docker-hosted emulator.

- Install the [Azure CosmosDB Emulator](https://learn.microsoft.com/en-us/azure/cosmos-db/how-to-develop-emulator)
- Export the Azure CosmosDB Emulator certificate
  - Open the Windows Certificate Manager
  - Navigate to `Trusted Root Certification Authorities` > `Certificates`
  - Find the certificate for Issued To: `localhost`, Friendly Name: `DocumentDbEmulatorCertificate`
  - Right-click the certificate and select `All Tasks` > `Export...`
  - No, do not export the private key
  - Base-64 encoded X.509 (.CER)
  - Save the file
