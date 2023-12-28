# terraform {
#   backend "s3" {
#     bucket         = "bsa-tfstate-dev"
#     region         = "us-east-1"
#     profile        = "bsadev-terraform"
#     dynamodb_table = "tfstate_dev"
#     key            = "api-us-east-1/terraform.tfstate"
#   }
# }

terraform {
  backend "s3" {
  }
}
