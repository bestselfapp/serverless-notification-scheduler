provider "aws" {
  region  = "${var.aws_primary_region}"
  profile = "${var.aws_tf_profile}"

  default_tags {
    tags = {
      __application_id = "bsa"
    }
  }
}
